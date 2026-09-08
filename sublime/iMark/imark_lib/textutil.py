"""Text helpers: the editor (JavaScript) addresses the document in UTF-16 code
units while Sublime Text and Python use code points, so incoming change offsets
are converted before they are applied. Pure functions, unit tested."""


def normalize_eol(text):
    return text.replace('\r\n', '\n').replace('\r', '\n') if '\r' in text else text


def utf16_length(text):
    """Length of ``text`` in UTF-16 code units."""
    return len(text.encode('utf-16-le', 'surrogatepass')) // 2


def has_astral(text):
    """True when ``text`` contains characters outside the BMP (UTF-16 surrogate pairs)."""
    return utf16_length(text) != len(text)


def utf16_to_index(text, offset, astral=None):
    """Convert a UTF-16 code-unit offset into ``text`` to a Python string index."""
    if offset < 0:
        raise ValueError('negative offset')
    if astral is None:
        astral = has_astral(text)
    if not astral:
        if offset > len(text):
            raise ValueError('offset %d beyond end of text (%d)' % (offset, len(text)))
        return offset
    units = 0
    for i, ch in enumerate(text):
        if units == offset:
            return i
        width = 2 if ord(ch) > 0xFFFF else 1
        if units + width > offset:
            # offset points into the middle of a surrogate pair
            raise ValueError('offset %d splits a surrogate pair' % offset)
        units += width
    if units == offset:
        return len(text)
    raise ValueError('offset %d beyond end of text (%d units)' % (offset, units))


def sanitize_text(text):
    """Drop lone surrogates that JSON from the browser could carry."""
    try:
        text.encode('utf-8')
        return text
    except UnicodeEncodeError:
        return text.encode('utf-8', 'replace').decode('utf-8')


def convert_changes(text, changes, astral=None):
    """Turn editor changes (UTF-16 offsets, any order) into sorted, non-overlapping
    ``(start, end, insert)`` tuples with Python indexes. Raises ``ValueError``."""
    if astral is None:
        astral = has_astral(text)
    out = []
    for c in changes:
        start = utf16_to_index(text, int(c['from']), astral)
        end = utf16_to_index(text, int(c['to']), astral)
        if end < start:
            raise ValueError('change end before start')
        out.append((start, end, sanitize_text(str(c.get('insert', '')))))
    out.sort(key=lambda c: c[0])
    pos = -1
    for start, end, _ in out:
        if start < pos:
            raise ValueError('changes overlap')
        pos = end
    return out


def apply_changes(text, changes):
    """Apply sorted, non-overlapping ``(start, end, insert)`` changes (Python indexes)."""
    parts = []
    pos = 0
    for start, end, insert in changes:
        if start < pos:
            raise ValueError('changes must be sorted and non-overlapping')
        parts.append(text[pos:start])
        parts.append(insert)
        pos = end
    parts.append(text[pos:])
    return ''.join(parts)


def diff_change(a, b):
    """Single minimal replacement turning ``a`` into ``b`` (common prefix/suffix)."""
    if a == b:
        return None
    start = 0
    limit = min(len(a), len(b))
    while start < limit and a[start] == b[start]:
        start += 1
    end_a, end_b = len(a), len(b)
    while end_a > start and end_b > start and a[end_a - 1] == b[end_b - 1]:
        end_a -= 1
        end_b -= 1
    return start, end_a, b[start:end_b]
