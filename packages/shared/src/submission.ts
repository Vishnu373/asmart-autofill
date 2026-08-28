/** The 13 fields the patient fills in, in the design's JSON shape. */
export interface Submission {
  first_name: string;
  last_name: string;
  preferred_name?: string;
  address: string;
  city: string;
  province: string;
  postal_code: string;
  phone: string;
  email?: string;
  date_of_birth: string;
  health_insurance_number: string;
  health_insurance_version?: string;
  hc_type: string;
}

export interface Option {
  value: string;
  label: string;
}

/**
 * OSCAR's province and HC-type boxes are dropdowns whose options read `ON`, not
 * "Ontario". Collecting the code is what makes the value staff copy out the one
 * the dropdown actually takes.
 */
export const PROVINCES: readonly Option[] = [
  { value: 'AB', label: 'Alberta' },
  { value: 'BC', label: 'British Columbia' },
  { value: 'MB', label: 'Manitoba' },
  { value: 'NB', label: 'New Brunswick' },
  { value: 'NL', label: 'Newfoundland and Labrador' },
  { value: 'NS', label: 'Nova Scotia' },
  { value: 'NT', label: 'Northwest Territories' },
  { value: 'NU', label: 'Nunavut' },
  { value: 'ON', label: 'Ontario' },
  { value: 'PE', label: 'Prince Edward Island' },
  { value: 'QC', label: 'Quebec' },
  { value: 'SK', label: 'Saskatchewan' },
  { value: 'YT', label: 'Yukon' },
];

export interface Field {
  name: keyof Submission;
  label: string;
  optional?: true;
  options?: readonly Option[];
}

export const FIELDS: readonly Field[] = [
  { name: 'first_name', label: 'First name' },
  { name: 'last_name', label: 'Last name' },
  { name: 'preferred_name', label: 'Preferred name', optional: true },
  { name: 'address', label: 'Address' },
  { name: 'city', label: 'City' },
  { name: 'province', label: 'Province', options: PROVINCES },
  { name: 'postal_code', label: 'Postal code' },
  { name: 'phone', label: 'Phone number' },
  { name: 'email', label: 'Email', optional: true },
  { name: 'date_of_birth', label: 'Date of birth' },
  { name: 'health_insurance_number', label: 'Health card number' },
  { name: 'health_insurance_version', label: 'Health card version', optional: true },
  { name: 'hc_type', label: 'Health card province', options: PROVINCES },
];
