/** Manifest and frontmatter shapes for the Claude Code plugin ecosystem. */

export interface PluginAuthor {
  readonly name: string;
  readonly email?: string;
  readonly url?: string;
}

/** `.claude-plugin/plugin.json` */
export interface PluginManifest {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly author?: PluginAuthor;
}

/** A non-path plugin source: github / url / git-subdir / npm. */
export interface MarketplaceSourceSpec {
  readonly source: 'github' | 'url' | 'git-subdir' | 'npm';
  readonly repo?: string;
  readonly url?: string;
  readonly path?: string;
  readonly package?: string;
  readonly version?: string;
  readonly registry?: string;
}

/** One entry in a marketplace's `plugins` array. */
export interface MarketplacePlugin {
  readonly name: string;
  /** A relative path to the plugin dir, or a git/npm source spec object. */
  readonly source: string | MarketplaceSourceSpec;
  readonly description?: string;
}

/** `.claude-plugin/marketplace.json` */
export interface MarketplaceManifest {
  readonly name: string;
  readonly owner?: { readonly name: string; readonly email?: string };
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly plugins: readonly MarketplacePlugin[];
}

/** Parsed YAML-subset frontmatter from a `SKILL.md`. */
export interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly license?: string;
  readonly 'allowed-tools'?: readonly string[];
  readonly 'user-invocable'?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  readonly severity: IssueSeverity;
  /** Dotted path to the offending field, e.g. `plugins[2].source`. */
  readonly path: string;
  readonly message: string;
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}
