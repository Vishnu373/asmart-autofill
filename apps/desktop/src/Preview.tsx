import { FIELDS } from '@asmart/shared';

/**
 * Answers "what does the tablet ask for?" at the desk, so nobody walks over to
 * read the form. Built from the same FIELDS the form is built from: a list
 * typed out by hand would be wrong the first time a field changed.
 */
export function Preview() {
  return (
    <section className="preview">
      <p className="hint">What the tablet asks, in order. All {FIELDS.length} are required.</p>
      <ol>
        {FIELDS.map(({ name, label, options }) => (
          <li key={name}>
            <span className="value">{label}</span>
            {options && <span className="tag">Dropdown</span>}
            {options && (
              <span className="choices">{options.map((option) => option.value).join(' · ')}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
