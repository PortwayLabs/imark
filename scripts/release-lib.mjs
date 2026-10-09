// Pure helpers for the release script (no side effects) so they can be unit tested.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(v) {
  const m = SEMVER.exec(String(v).trim().replace(/^v/, ''));
  if (!m) throw new Error(`Invalid semver version: ${v}`);
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null };
}

/** Compute the next version from a bump keyword or an explicit version. */
export function bumpVersion(current, spec) {
  const cur = parseVersion(current);
  switch (spec) {
    case 'major':
      return `${cur.major + 1}.0.0`;
    case 'minor':
      return `${cur.major}.${cur.minor + 1}.0`;
    case 'patch':
      return cur.pre ? `${cur.major}.${cur.minor}.${cur.patch}` : `${cur.major}.${cur.minor}.${cur.patch + 1}`;
    default: {
      const next = parseVersion(spec);
      if (compareVersions(next, cur) <= 0) throw new Error(`New version ${spec} must be greater than current ${current}`);
      return `${next.major}.${next.minor}.${next.patch}${next.pre ? `-${next.pre}` : ''}`;
    }
  }
}

export function compareVersions(a, b) {
  const pa = typeof a === 'string' ? parseVersion(a) : a;
  const pb = typeof b === 'string' ? parseVersion(b) : b;
  for (const k of ['major', 'minor', 'patch']) if (pa[k] !== pb[k]) return pa[k] - pb[k];
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const UNRELEASED = /^##\s+(unreleased|未发布)\s*$/im;

/**
 * Prepare a changelog for `version`:
 * - an "Unreleased" / "未发布" section becomes `## <version> (<date>)`;
 * - an existing `## <version>` heading gets the date appended when missing;
 * - otherwise the changelog is rejected.
 * Returns the new text and the body of the release section.
 */
export function prepareChangelog(text, version, date = today()) {
  const heading = `## ${version} (${date})`;
  let out;
  if (UNRELEASED.test(text)) {
    out = text.replace(UNRELEASED, heading);
  } else {
    const existing = new RegExp(`^##\\s+v?${version.replace(/\./g, '\\.')}(\\s*\\(.*\\))?\\s*$`, 'm');
    const m = existing.exec(text);
    if (!m) {
      throw new Error(`No "## Unreleased" / "## ${version}" section found in changelog`);
    }
    out = m[1] ? text : text.replace(existing, heading);
  }
  const body = extractSection(out, version);
  if (!body.trim()) throw new Error(`Changelog section for ${version} is empty`);
  return { text: out, body };
}

/** Body (without heading) of the `## <version>` section. */
export function extractSection(text, version) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^##\\s+v?${version.replace(/\./g, '\\.')}(\\s|$)`).test(l));
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

/** Check that every `%key%` placeholder in package.json exists in each nls bundle. */
export function missingNlsKeys(packageJson, bundles) {
  const used = new Set(String(JSON.stringify(packageJson)).match(/%([A-Za-z0-9_.-]+)%/g)?.map((s) => s.slice(1, -1)) ?? []);
  const missing = {};
  for (const [name, bundle] of Object.entries(bundles)) {
    const absent = [...used].filter((k) => !(k in bundle));
    if (absent.length) missing[name] = absent;
  }
  return missing;
}

export function parseArgs(argv) {
  const opts = {
    bump: null,
    dryRun: false,
    skipTests: false,
    skipVscodeTests: false,
    skipSublime: false,
    skipChangelog: false,
    noGit: false,
    push: false,
    publish: false,
    githubRelease: false,
    allowDirty: false,
    out: 'release',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--skip-tests':
        opts.skipTests = true;
        break;
      case '--skip-vscode-tests':
        opts.skipVscodeTests = true;
        break;
      case '--skip-sublime':
        opts.skipSublime = true;
        break;
      case '--skip-changelog':
        opts.skipChangelog = true;
        break;
      case '--no-git':
        opts.noGit = true;
        break;
      case '--push':
        opts.push = true;
        break;
      case '--publish':
        opts.publish = true;
        break;
      case '--github-release':
        opts.githubRelease = true;
        break;
      case '--allow-dirty':
        opts.allowDirty = true;
        break;
      case '--out':
        opts.out = argv[++i] ?? opts.out;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`);
        if (opts.bump) throw new Error(`Unexpected argument: ${a}`);
        opts.bump = a;
    }
  }
  return opts;
}
