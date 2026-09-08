"""Regression tests for the threading rule: helpers used from server / worker
threads must never call the Sublime API (an API call from a background thread
waits for the plugin host's main thread; if that thread is waiting on a lock
held by the caller, Sublime Text deadlocks)."""
import threading
import unittest

import _env  # pylint: disable=unused-import

import sublime  # noqa: E402
from iMark.imark_lib import util  # noqa: E402

GUARDED = ('load_settings', 'save_settings', 'cache_path', 'packages_path', 'platform', 'load_resource', 'load_binary_resource', 'find_resources', 'windows', 'active_window', 'status_message')


class ApiGuard:
    """Make the listed sublime functions raise when called off the main thread."""

    def __init__(self, names):
        self.names = names
        self.originals = {}
        self.main = threading.current_thread()

    def __enter__(self):
        for name in self.names:
            fn = getattr(sublime, name)
            self.originals[name] = fn

            def wrapper(*args, _fn=fn, _name=name, **kwargs):
                if threading.current_thread() is not self.main:
                    raise AssertionError('sublime.%s called from a background thread' % _name)
                return _fn(*args, **kwargs)

            setattr(sublime, name, wrapper)
        return self

    def __exit__(self, *exc):
        for name, fn in self.originals.items():
            setattr(sublime, name, fn)


class UtilThreadSafetyTest(unittest.TestCase):
    def setUp(self):
        sublime.reset()
        sublime.load_settings(util.SETTINGS_FILE).set('debug', True)
        util.init_cache()

    def test_cached_helpers_do_not_touch_the_api_off_main_thread(self):
        errors = []
        results = {}

        def worker():
            try:
                util.log('from a server thread: %s', 'ok')
                util.log_exception('no exception pending is fine')
                results['platform'] = util.platform()
                results['cache_dir'] = util.cache_dir()
                results['package_dir'] = util.package_dir()
                results['user_dir'] = util.user_dir()
                results['version'] = util.package_version()
                results['debug'] = util.debug_enabled()
            except Exception as exc:  # pylint: disable=broad-except
                errors.append(exc)

        with ApiGuard(GUARDED):
            t = threading.Thread(target=worker)
            t.start()
            t.join(5)
        self.assertEqual(errors, [])
        self.assertEqual(results['platform'], util.platform())
        self.assertEqual(results['version'], '0.0.0-test')
        self.assertTrue(results['debug'])
        self.assertTrue(results['cache_dir'].endswith('iMark'))

    def test_init_cache_refreshes_debug_flag(self):
        sublime.load_settings(util.SETTINGS_FILE).set('debug', False)
        self.assertTrue(util.debug_enabled(), 'flag is a snapshot until init_cache runs')
        util.init_cache()
        self.assertFalse(util.debug_enabled())

    def test_call_on_main_runs_on_main_thread(self):
        main = threading.current_thread()
        box = {}

        def worker():
            try:
                box['thread'] = util.call_on_main(lambda: threading.current_thread(), timeout=5)
            except Exception as exc:  # pylint: disable=broad-except
                box['error'] = exc

        t = threading.Thread(target=worker)
        t.start()
        self.assertTrue(sublime.pump_until(lambda: box, timeout=5))
        t.join(1)
        self.assertIs(box.get('thread'), main)

    def test_debouncer_coalesces(self):
        calls = []
        d = util.Debouncer(lambda v: calls.append(v), 10)
        d(1)
        d(2)
        d(3)
        sublime.pump(0.05)
        self.assertEqual(calls, [3])


if __name__ == '__main__':
    unittest.main()
