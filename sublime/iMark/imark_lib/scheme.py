"""'Follow Sublime Text' theme: derive the CSS variables that
media/css/vscode-bridge.css expects from the view's color scheme, so the editor
blends in with Sublime Text when no Obsidian theme is selected."""
import re

_HEX = re.compile(r'^#([0-9a-fA-F]{3,8})$')
_RGB = re.compile(r'^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$')


def parse_color(value):
    """'#rgb' / '#rrggbb' / '#rrggbbaa' / 'rgb()' / 'rgba()' → (r, g, b, a) or None."""
    if not value or not isinstance(value, str):
        return None
    value = value.strip()
    m = _HEX.match(value)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = ''.join(c * 2 for c in h)
        elif len(h) == 4:
            h = ''.join(c * 2 for c in h)
        if len(h) == 6:
            h += 'ff'
        if len(h) != 8:
            return None
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (int(h[6:8], 16) / 255.0,)
    m = _RGB.match(value)
    if m:
        r, g, b = (int(float(m.group(i))) for i in (1, 2, 3))
        a = float(m.group(4)) if m.group(4) else 1.0
        return (r, g, b, a)
    return None


def to_hex(rgb):
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(round(c)))) for c in rgb[:3])


def rgba(color, alpha):
    c = parse_color(color) or (128, 128, 128, 1.0)
    return 'rgba(%d, %d, %d, %.2f)' % (c[0], c[1], c[2], alpha)


def luminance(color):
    c = parse_color(color)
    if not c:
        return 0.0

    def lin(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])


def is_dark(color):
    return luminance(color) < 0.4


def mix(a, b, t):
    """Blend ``a`` towards ``b`` by ``t`` (0..1), returning '#rrggbb'."""
    ca = parse_color(a) or (0, 0, 0, 1.0)
    cb = parse_color(b) or (255, 255, 255, 1.0)
    return to_hex(tuple(ca[i] + (cb[i] - ca[i]) * t for i in range(3)))


def contrast_text(background):
    return '#000000' if luminance(background) > 0.45 else '#ffffff'


def opaque(color, fallback):
    """Return the color as '#rrggbb' (dropping alpha), or ``fallback``."""
    c = parse_color(color)
    return to_hex(c) if c else fallback


def view_is_dark(view):
    try:
        bg = view.style().get('background')
    except Exception:  # pylint: disable=broad-except
        bg = None
    return is_dark(bg) if bg else True


def scheme_variables(style, scope_color, font_face=None):
    """Compute ``{css-variable: value}`` from a ``view.style()`` dict and a
    ``scope_color(scope) -> color|None`` function. Pure, unit tested."""
    bg = opaque(style.get('background'), '#1e1e1e')
    fg = opaque(style.get('foreground'), '#d4d4d4')
    dark = is_dark(bg)
    accent = opaque(style.get('accent'), None) or opaque(scope_color('markup.underline.link'), None) or ('#4daafc' if dark else '#005fb8')
    selection = style.get('selection') or mix(bg, accent, 0.35)
    caret = opaque(style.get('caret'), fg)
    line_highlight = style.get('line_highlight') or mix(bg, fg, 0.06)
    gutter = opaque(style.get('gutter'), None) or mix(bg, fg, 0.03)
    find = style.get('find_highlight') or mix(bg, accent, 0.5)
    guide = style.get('guide') or mix(bg, fg, 0.12)
    border = mix(bg, fg, 0.16)
    widget = mix(bg, fg, 0.05)
    muted = mix(fg, bg, 0.35)
    faint = mix(fg, bg, 0.55)

    def scope(name, fallback):
        c = scope_color(name)
        c = opaque(c, None) if c else None
        return c or fallback

    invalid = scope_color('invalid.illegal')
    error = opaque(invalid, None) or ('#f88070' if dark else '#f85149')
    editor_font = ', '.join(['"%s"' % font_face] if font_face else []) or ''
    editor_font = (editor_font + ', ' if editor_font else '') + 'ui-monospace, Menlo, Consolas, "Courier New", monospace'

    return {
        '--vscode-editor-background': bg,
        '--vscode-editor-foreground': fg,
        '--vscode-editorWidget-background': widget,
        '--vscode-editorWidget-border': border,
        '--vscode-sideBar-background': gutter,
        '--vscode-activityBar-background': gutter,
        '--vscode-widget-border': border,
        '--vscode-panel-border': border,
        '--vscode-focusBorder': accent,
        '--vscode-list-hoverBackground': line_highlight,
        '--vscode-list-activeSelectionBackground': selection,
        '--vscode-input-background': mix(bg, fg, 0.07),
        '--vscode-descriptionForeground': muted,
        '--vscode-disabledForeground': faint,
        '--vscode-textLink-foreground': scope('markup.underline.link', accent),
        '--vscode-textLink-activeForeground': mix(scope('markup.underline.link', accent), fg, 0.2),
        '--vscode-button-background': accent,
        '--vscode-button-hoverBackground': mix(accent, fg, 0.15),
        '--vscode-button-foreground': contrast_text(accent),
        '--vscode-button-secondaryBackground': mix(bg, fg, 0.12),
        '--vscode-button-secondaryHoverBackground': mix(bg, fg, 0.2),
        '--vscode-errorForeground': error,
        '--vscode-editorWarning-foreground': scope('constant.numeric', '#cca700'),
        '--vscode-editor-selectionBackground': selection,
        '--vscode-editor-findMatchHighlightBackground': rgba(find, 0.45),
        '--vscode-editor-findMatchBackground': find,
        '--vscode-editorCursor-foreground': caret,
        '--vscode-textCodeBlock-background': mix(bg, fg, 0.06),
        '--vscode-textBlockQuote-border': mix(bg, fg, 0.3),
        '--vscode-textBlockQuote-background': mix(bg, fg, 0.04),
        '--vscode-textSeparator-foreground': border,
        '--vscode-badge-background': mix(bg, fg, 0.2),
        '--vscode-checkbox-border': muted,
        '--vscode-editorIndentGuide-background': guide,
        '--vscode-scrollbarSlider-background': rgba(fg, 0.22),
        '--vscode-scrollbarSlider-activeBackground': rgba(fg, 0.45),
        '--vscode-widget-shadow': 'rgba(0, 0, 0, %s)' % ('0.36' if dark else '0.16'),
        '--vscode-font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif',
        '--vscode-editor-font-family': editor_font,
        '--vscode-symbolIcon-keywordForeground': scope('keyword', fg),
        '--vscode-symbolIcon-stringForeground': scope('string', fg),
        '--vscode-symbolIcon-functionForeground': scope('entity.name.function', fg),
        '--vscode-symbolIcon-propertyForeground': scope('variable.other.member', scope('support.type.property-name', fg)),
        '--vscode-symbolIcon-numberForeground': scope('constant.numeric', fg),
        '--vscode-symbolIcon-operatorForeground': scope('keyword.operator', fg),
        '--vscode-symbolIcon-classForeground': scope('entity.name.tag', scope('entity.name.class', fg)),
        '--vscode-symbolIcon-constantForeground': scope('constant.language', fg),
        '--vscode-menu-background': widget,
        '--vscode-menu-foreground': fg,
        '--vscode-menu-selectionBackground': accent,
        '--vscode-menu-selectionForeground': contrast_text(accent),
        '--imark-vscode-accent-rgb': '%d, %d, %d' % tuple(parse_color(accent)[:3]),
    }


def scheme_css(view):
    """CSS text for the active view's color scheme (empty when unavailable)."""
    if view is None:
        return ''
    try:
        style = view.style() or {}
    except Exception:  # pylint: disable=broad-except
        style = {}

    def scope_color(scope):
        try:
            return (view.style_for_scope(scope) or {}).get('foreground')
        except Exception:  # pylint: disable=broad-except
            return None

    try:
        font_face = view.settings().get('font_face') or None
    except Exception:  # pylint: disable=broad-except
        font_face = None
    variables = scheme_variables(style, scope_color, font_face)
    lines = ['body.imark-vscode-bridge {']
    for key in sorted(variables):
        lines.append('  %s: %s;' % (key, variables[key]))
    lines.append('}')
    return '\n'.join(lines) + '\n'
