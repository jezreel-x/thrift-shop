import { CONDITIONS, CONDITION_LABELS, GENDERS, GENDER_LABELS } from "../shop/catalogue";

/** Condition and fit as the product form's dropdowns list them. */
export const CONDITION_OPTIONS = CONDITIONS.map((value) => ({
  value,
  label: CONDITION_LABELS[value],
}));

export const GENDER_OPTIONS = GENDERS.map((value) => ({ value, label: GENDER_LABELS[value] }));
