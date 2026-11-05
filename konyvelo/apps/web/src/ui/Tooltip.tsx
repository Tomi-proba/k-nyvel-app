import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

const KONYVELO_DOBOZ = '[data-modul-keretben="konyvelo"]';
import { keretben } from "../keret/futas";
import { GLOSSARY, type GlossaryKey } from "../help/glossary";

/** Tooltip: egérrel rámutatva és billentyűzettel (fókusszal) is megjelenik. */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <RadixTooltip.Root delayDuration={300}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      {/* A keretben a Könyvelő dobozába (ott érvényes a stílusa), önállóan a dokumentum végére. */}
      <RadixTooltip.Portal container={keretben() ? (document.querySelector<HTMLElement>(KONYVELO_DOBOZ) ?? undefined) : undefined}>
        <RadixTooltip.Content className="tooltip" sideOffset={6}>
          {content}
          <RadixTooltip.Arrow className="tooltip-arrow" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/** ⓘ súgó egy szakkifejezéshez. A szöveget képernyőolvasó is felolvassa. */
export function HelpTip({ term }: { term: GlossaryKey }) {
  const g = GLOSSARY[term];
  return (
    <Tooltip
      content={
        <>
          <strong>{g.title}</strong>
          <br />
          {g.text}
        </>
      }
    >
      <button type="button" className="help-tip" aria-label={`Súgó: ${g.title}. ${g.text}`}>
        i
      </button>
    </Tooltip>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}
