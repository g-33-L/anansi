/**
 * Anansi Skill Schema v1
 *
 * A `SkillDefinition` is the canonical, versioned representation of a published
 * enterprise skill. It wraps everything the extraction pipeline produces
 * (steps, ordering, gates, conditions, deadlines, parallel groups, evidence
 * citations) with the governance envelope needed for lifecycle management
 * (versioning, review, publication, source tracing).
 *
 * Design constraints:
 *  - Fully JSON-serializable — no functions, no class instances.
 *  - Steps carry stable `id` values so two versions of the same skill can be
 *    diffed step-by-step.
 *  - Primitive predicate / deadline / condition types are defined here
 *    independently of the extraction internals to keep this schema self-contained.
 *    The extraction worker is responsible for mapping ExtractedProcedure →
 *    SkillDefinition when it promotes a skill to "draft".
 */

// ---------------------------------------------------------------------------
// Primitive / shared types
// ---------------------------------------------------------------------------

/**
 * A boolean-valued gate predicate.  Mirrors `ExtractedPredicate` exactly so
 * the extraction worker can copy values without transformation.
 */
export type SkillPredicate = {
  subject: string;
  operator: 'equals' | 'greater_than' | 'missing' | 'after';
  value?: string;
  unit?: string;
};

/**
 * A time-to-complete constraint on a step.
 */
export type SkillDeadline = {
  value: number;
  unit: 'minutes' | 'hours' | 'days' | 'business_days';
  /** The event or milestone the deadline is measured from, verbatim from source. */
  relativeTo: string;
};

/**
 * A branching condition attached to a step.
 * `thenSteps` / `elseSteps` reference sibling step IDs within the same skill.
 */
export type SkillCondition = {
  when: SkillPredicate;
  thenSteps: string[];
  elseSteps?: string[];
};

/**
 * A cross-step gate: the `predicate` must hold before any step in `appliesTo`
 * may begin.  Evidence is a list of source chunk IDs that state this constraint.
 */
export type SkillGate = {
  predicate: SkillPredicate;
  appliesTo: string[];
  evidence: string[];
};

/**
 * A named group of steps that execute in parallel.
 * Members reference step IDs within the same skill.
 */
export type SkillParallelGroup = {
  id: string;
  members: string[];
  semantics: 'unordered' | 'required_concurrent';
  evidence: string[];
};

/**
 * Multi-step relational structure extracted for the skill as a whole.
 * Individual steps also carry inline `preconditions` and `parallel` fields;
 * these graph-level entries capture the same facts with their full member sets
 * and evidence citations for auditing.
 */
export type SkillGraph = {
  gates?: SkillGate[];
  parallelGroups?: SkillParallelGroup[];
};

// ---------------------------------------------------------------------------
// SkillStep
// ---------------------------------------------------------------------------

/**
 * A single step in a skill's procedure.
 *
 * Stable identity: `id` is set when the step is first extracted and preserved
 * across revisions so callers can diff two `SkillDefinition` versions by
 * step ID.
 *
 * Maps from `ExtractedStep` (the extraction pipeline's internal type):
 *   ExtractedStep.stepId          → SkillStep.id
 *   ExtractedStep.evidence        → SkillStep.evidence   (source chunk ID strings)
 *   ExtractedStep.precedes        → SkillStep.precedes
 *   ExtractedStep.ownerRole       → SkillStep.ownerRole
 *   ExtractedStep.preconditions   → SkillStep.preconditions
 *   ExtractedStep.conditions      → SkillStep.conditions
 *   ExtractedStep.deadline        → SkillStep.deadline
 *   ExtractedStep.parallel        → SkillStep.parallel
 *   ExtractedStep.temporalConstraints → SkillStep.temporalConstraints
 */
export interface SkillStep {
  /** Stable, snake_case identifier. Preserved across versions for diffing. */
  id: string;

  /** One-sentence description of what this step does, as extracted from the source. */
  description: string;

  /**
   * Source chunk IDs that directly support this step's existence.
   * Each ID must refer to a chunk in `SkillDefinition.sourceDocumentIds`.
   */
  evidence: string[];

  /**
   * IDs of steps that this step must come before (forward ordering edges).
   * The canonical direction: the earlier step lists the IDs of steps that follow it.
   */
  precedes?: string[];

  /**
   * The role responsible for executing this step, verbatim from the source document.
   */
  ownerRole?: string;

  /**
   * Entry gates: conditions that must be satisfied before this step can begin.
   * Not the same as `conditions` (which describe branching); these are pure guards.
   */
  preconditions?: SkillPredicate[];

  /**
   * Explicit if/unless branches attached to this step.
   * `thenSteps` / `elseSteps` reference sibling step IDs.
   */
  conditions?: SkillCondition[];

  /**
   * Time constraint on this step's completion.
   */
  deadline?: SkillDeadline;

  /**
   * Parallel execution group membership.  Steps sharing the same `group` string
   * may be executed concurrently.
   */
  parallel?: {
    group: string;
    semantics: 'unordered' | 'required_concurrent';
  };

  /**
   * Temporal validity constraints on this step.
   * `validUntil` is an ISO 8601 date/time after which the step may be superseded.
   */
  temporalConstraints?: {
    validUntil?: string;
  };
}

// ---------------------------------------------------------------------------
// SkillDefinition
// ---------------------------------------------------------------------------

export type SkillStatus = 'draft' | 'review' | 'published' | 'archived';

/**
 * A published, versioned enterprise skill.
 *
 * A skill is extracted from one or more policy documents and then promoted
 * through the governance lifecycle: draft → review → published → (archived).
 * Each published version is immutable; updates produce a new version.
 */
export interface SkillDefinition {
  // --- Identity ---

  /** UUID assigned at creation time. Stable across all versions of this skill. */
  id: string;

  /**
   * Semantic version string (e.g. "1.0.0").
   * Incremented by the publication worker on each approved update.
   * Patch bumps for evidence/wording corrections; minor for step additions;
   * major for structural procedure changes.
   */
  version: string;

  /** Lifecycle stage. Only `published` skills are served to agents by default. */
  status: SkillStatus;

  // --- Classification ---

  /**
   * Machine-readable domain classifier.  Matches the `domain` field passed to
   * the extraction worker (e.g. "emergency_termination", "vendor_onboarding").
   * Used for routing, filtering, and benchmark grouping.
   */
  domain: string;

  /**
   * Human-readable skill name, suitable for display in the design-partner UI.
   * Example: "Emergency Employee Termination"
   */
  title: string;

  /**
   * Short plain-English explanation of what situation this skill handles and
   * what outcome it produces.  Used in search results and design-partner docs.
   */
  description: string;

  // --- Procedure ---

  /**
   * The ordered list of steps in this skill's procedure.
   * Ordering is encoded in each step's `precedes` field; the array order is
   * informational only.
   */
  steps: SkillStep[];

  /**
   * Multi-step relational structure (gates spanning multiple steps, parallel
   * groups).  Complements the inline fields on individual steps.
   */
  graph?: SkillGraph;

  // --- Provenance ---

  /**
   * IDs of the source documents (policy PDFs, wiki pages, etc.) from which
   * this skill was extracted.  Used to rebuild the skill when source docs are
   * updated.
   */
  sourceDocumentIds: string[];

  /**
   * ISO 8601 timestamp of when the extraction worker produced this skill.
   * Set once at extraction time and never changed.
   */
  extractedAt: string;

  // --- Governance ---

  /**
   * ISO 8601 timestamp of when this version was approved and published.
   * Absent on draft and review-stage skills.
   */
  publishedAt?: string;

  /**
   * User ID of the reviewer who approved this skill for publication.
   * Absent until the skill passes review.
   */
  reviewedBy?: string;

  /**
   * Extraction confidence score in the range [0, 1].
   * Populated by the extraction worker based on evidence coverage and graph
   * completeness metrics.  Used to triage skills that need human review.
   * Omitted when the extraction worker cannot compute a meaningful score.
   */
  confidenceScore?: number;
}

// ---------------------------------------------------------------------------
// SkillVersion — lightweight versions-table record
// ---------------------------------------------------------------------------

/**
 * A lightweight pointer to one version of a skill, stored in the versions table.
 * The full `SkillDefinition` payload lives in a separate content store;
 * `SkillVersion` is what the list/history API returns without fetching the steps.
 */
export interface SkillVersion {
  /** Matches `SkillDefinition.id`. */
  skillId: string;

  /** Matches `SkillDefinition.version`. */
  version: string;

  status: SkillStatus;

  domain: string;

  title: string;

  extractedAt: string;

  publishedAt?: string;

  reviewedBy?: string;

  /**
   * Optional human- or auto-generated summary of what changed relative to the
   * previous version.  Displayed in the version history UI.
   */
  changeSummary?: string;
}
