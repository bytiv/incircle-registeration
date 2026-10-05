"use client";

import { useState } from "react";

import { AddPersonCard } from "@/components/admin/people/AddPersonCard";
import { usePageScrollLock } from "@/components/admin/people/bits";
import { BulkAddCard } from "@/components/admin/people/BulkAddCard";
import type { NewPerson } from "@/components/admin/people/types";
import { Drawer, LinkBtn, Tabs } from "@/components/admin/ui";

type Way = "one" | "list";

/**
 * ADD SOMEONE — a drawer, like the person it makes.
 *
 * Two ways in, as tabs, each with its one action at the foot: one person (the
 * same form their drawer edits with) or a pasted list. Each tab rises in.
 * (CIB has a third, people from past events; registration has one event.)
 */
export function AddDrawer({
  open,
  onClose,
  lastError,
  onAdd,
  onBulk,
}: {
  open: boolean;
  onClose: () => void;
  /** Why the last write failed (AdminRoot's error line, which the drawer covers). */
  lastError: string;
  /** Resolve with the route's answer once the list has it; null when it failed. */
  onAdd: (person: NewPerson) => Promise<unknown>;
  onBulk: (text: string) => Promise<unknown>;
}) {
  const [way, setWay] = useState<Way>("one");
  usePageScrollLock(open);

  return (
    <Drawer open={open} onClose={onClose} wide bare label="Add people">
      <div className="pv-form">
        <div className="pv-formbar">
          <span className="pv-kick">Add people</span>
          <LinkBtn onClick={onClose}>Close</LinkBtn>
        </div>
        <div className="ppl-addtabs">
          <Tabs
            value={way}
            onChange={setWay}
            items={[
              { key: "one", label: "One person" },
              { key: "list", label: "A list" },
            ]}
          />
        </div>
        <div key={way} className="ppl-tabin pv-tab">
          {way === "one" ? <AddPersonCard lastError={lastError} onAdd={onAdd} /> : <BulkAddCard lastError={lastError} onBulk={onBulk} />}
        </div>
      </div>
    </Drawer>
  );
}
