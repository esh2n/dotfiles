/**
 * A skill the router may pick, as the list a harness would describe it.
 *
 * `path` is carried because the caller hands the model a place to read rather than the body
 * itself: injecting the body would put back most of the list tokens the router exists to
 * remove.
 *
 * This lives in the domain rather than beside one question, because two questions ask about
 * candidates and this type is what they agree on — `app/routing/select-skills.ts` judges
 * them, `infra/skills/catalog.ts` reads them off disk, and both harnesses turn the answer
 * into a reminder.
 */
export interface SkillCandidate {
  readonly name: string;
  readonly description: string;
  /** Where the skill's body is, so the reminder can point at it instead of carrying it. */
  readonly path: string;
}
