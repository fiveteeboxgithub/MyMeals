import { Fragment } from 'react';

/** Un libellé qui peut passer à la ligne après chaque « / » plutôt qu'au milieu d'un mot. */
export function Breakable({ text }: { text: string }) {
  const parts = text.split('/');
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <>
              /<wbr />
            </>
          )}
          {part}
        </Fragment>
      ))}
    </>
  );
}
