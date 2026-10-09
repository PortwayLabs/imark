"""Stand-in for Sublime Text's ``sublime_plugin`` module: command base classes
with a registry so ``view.run_command('imark_apply_changes', …)`` and event
dispatch work outside Sublime Text."""
import re

_commands = {'application': {}, 'window': {}, 'text': {}}
_listeners = []


def command_name(class_name):
    name = class_name[:-len('Command')] if class_name.endswith('Command') else class_name
    return re.sub(r'(?<!^)(?=[A-Z])', '_', name).lower()


class _Registered:
    _kind = None

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if cls._kind and not cls.__name__.startswith('_'):
            _commands[cls._kind][command_name(cls.__name__)] = cls


class ApplicationCommand(_Registered):
    _kind = 'application'

    def run(self, **kwargs):
        raise NotImplementedError

    def is_enabled(self, **kwargs):  # pylint: disable=unused-argument
        return True

    def is_visible(self, **kwargs):  # pylint: disable=unused-argument
        return True


class WindowCommand(_Registered):
    _kind = 'window'

    def __init__(self, window):
        self.window = window

    def run(self, **kwargs):
        raise NotImplementedError

    def is_enabled(self, **kwargs):  # pylint: disable=unused-argument
        return True

    def is_visible(self, **kwargs):  # pylint: disable=unused-argument
        return True


class TextCommand(_Registered):
    _kind = 'text'

    def __init__(self, view):
        self.view = view

    def run(self, edit, **kwargs):
        raise NotImplementedError

    def is_enabled(self, **kwargs):  # pylint: disable=unused-argument
        return True

    def is_visible(self, **kwargs):  # pylint: disable=unused-argument
        return True


class EventListener:
    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        _listeners.append(cls())


class ViewEventListener:
    def __init__(self, view):
        self.view = view


def find_application_command(name):
    return _commands['application'].get(name)


def find_window_command(name):
    return _commands['window'].get(name)


def find_text_command(name):
    return _commands['text'].get(name)


def dispatch_event(name, view, *args):
    for listener in list(_listeners):
        fn = getattr(listener, name, None)
        if fn is not None:
            fn(view, *args)
