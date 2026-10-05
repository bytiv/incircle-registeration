/**
 * The purge's vocabulary — what a "delete for good" asks before it acts.
 *
 * CIB's lib/admin/runs.ts holds the whole RUN vocabulary (archives, restarts,
 * their impact counts); registration keeps only the one-person half, which
 * People's DELETE FOR GOOD sheet speaks. Not server-only: the sheet reads it
 * in the browser.
 */

/**
 * What deleting ONE person for good would take with them — counted before
 * anything happens. In CIB that is the phone signed in as them; registration
 * has no phones, so it is always zero and the sheet says what goes instead.
 */
export type PersonImpact = {
  /** A phone signed in as them (CIB's event app). */
  joined: number;
};

export const ZERO_PERSON_IMPACT: PersonImpact = {
  joined: 0,
};

/** A sheet listing zeroes says nothing: only what is actually there. */
export function personImpactLines(i: PersonImpact): { label: string; value: number }[] {
  const all: { label: string; value: number }[] = [
    { label: "phone signed in as them", value: i.joined },
  ];
  return all.filter((line) => line.value > 0);
}

/**
 * What a purge answers on the FIRST, unconfirmed press: `needsConfirm` means
 * nothing was written, and these are the numbers to show.
 */
export type PersonAsk = { needsConfirm?: boolean; personImpact?: PersonImpact };
