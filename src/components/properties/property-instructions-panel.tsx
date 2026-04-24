"use client";

import { useMemo, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Car,
  DoorOpen,
  Dog,
  Flame,
  Info,
  KeyRound,
  Languages,
  LogOut,
  Pencil,
  Plus,
  Save,
  Scissors,
  Sparkles,
  Trash2,
  Waves,
  Wifi,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";

type InstructionCategory =
  | "access"
  | "trash"
  | "lawn"
  | "hot_tub"
  | "pool"
  | "parking"
  | "wifi"
  | "checkout"
  | "pets"
  | "other";

type InstructionLang = "en" | "es";

type Instruction = {
  id: string;
  category: InstructionCategory;
  title: string;
  body: string;
  sourceLang?: InstructionLang;
  translations?: Partial<
    Record<InstructionLang, { title: string; body: string }>
  >;
  updatedAt: number;
};

const CATEGORY_OPTIONS: Array<{
  value: InstructionCategory;
  label: string;
  icon: typeof Info;
  tint: string;
}> = [
  { value: "access",   label: "Access",      icon: DoorOpen, tint: "text-sky-500" },
  { value: "trash",    label: "Trash",       icon: Trash2,   tint: "text-amber-600" },
  { value: "lawn",     label: "Lawn",        icon: Scissors, tint: "text-emerald-500" },
  { value: "hot_tub",  label: "Hot tub",     icon: Flame,    tint: "text-rose-500" },
  { value: "pool",     label: "Pool",        icon: Waves,    tint: "text-cyan-500" },
  { value: "parking",  label: "Parking",     icon: Car,      tint: "text-indigo-500" },
  { value: "wifi",     label: "Wi-Fi",       icon: Wifi,     tint: "text-violet-500" },
  { value: "checkout", label: "Checkout",    icon: LogOut,   tint: "text-fuchsia-500" },
  { value: "pets",     label: "Pets",        icon: Dog,      tint: "text-orange-500" },
  { value: "other",    label: "Other",       icon: Info,     tint: "text-slate-500" },
];

const CATEGORY_BY_VALUE = new Map(
  CATEGORY_OPTIONS.map((option) => [option.value, option] as const),
);

export function PropertyInstructionsPanel({
  propertyId,
  accessNotes,
  keyLocation,
  parkingNotes,
  urgentNotes,
  instructions,
}: {
  propertyId: string;
  accessNotes?: string | null;
  keyLocation?: string | null;
  parkingNotes?: string | null;
  urgentNotes?: string | null;
  instructions?: Instruction[] | null;
}) {
  return (
    <div className="space-y-6">
      <AccessFieldsCard
        propertyId={propertyId}
        accessNotes={accessNotes ?? ""}
        keyLocation={keyLocation ?? ""}
        parkingNotes={parkingNotes ?? ""}
        urgentNotes={urgentNotes ?? ""}
      />
      <InstructionsCard
        propertyId={propertyId}
        instructions={instructions ?? []}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Access fields (4 legacy "before you arrive" fields)
// ---------------------------------------------------------------------------

function AccessFieldsCard({
  propertyId,
  accessNotes,
  keyLocation,
  parkingNotes,
  urgentNotes,
}: {
  propertyId: string;
  accessNotes: string;
  keyLocation: string;
  parkingNotes: string;
  urgentNotes: string;
}) {
  const { showToast } = useToast();
  const updateAccess = useMutation(api.properties.mutations.updateAccessFields);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    accessNotes,
    keyLocation,
    parkingNotes,
    urgentNotes,
  });
  const [saving, setSaving] = useState(false);

  const beginEdit = () => {
    setDraft({ accessNotes, keyLocation, parkingNotes, urgentNotes });
    setEditing(true);
  };

  const cancel = () => {
    setDraft({ accessNotes, keyLocation, parkingNotes, urgentNotes });
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateAccess({
        id: propertyId as Id<"properties">,
        accessNotes: draft.accessNotes,
        keyLocation: draft.keyLocation,
        parkingNotes: draft.parkingNotes,
        urgentNotes: draft.urgentNotes,
      });
      showToast("Access notes updated.");
      setEditing(false);
    } catch (error) {
      showToast(getErrorMessage(error, "Failed to save access notes."), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border bg-[var(--card)]">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Before you arrive
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            Shown to cleaners on the property page and job detail.
          </p>
        </div>
        {!editing ? (
          <button
            onClick={beginEdit}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--accent)]"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              onClick={cancel}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--accent)] disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        )}
      </header>

      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <AccessField
          label="Urgent — check every time"
          placeholder="e.g. Gate latch is loose; lift before pulling."
          value={editing ? draft.urgentNotes : urgentNotes}
          readOnly={!editing}
          onChange={(v) => setDraft((d) => ({ ...d, urgentNotes: v }))}
          accent="urgent"
        />
        <AccessField
          label="Entry instructions"
          placeholder="e.g. Lockbox on left side of porch; code 5542."
          value={editing ? draft.accessNotes : accessNotes}
          readOnly={!editing}
          onChange={(v) => setDraft((d) => ({ ...d, accessNotes: v }))}
        />
        <AccessField
          label="Key location"
          placeholder="e.g. Key on hook behind the kitchen door."
          value={editing ? draft.keyLocation : keyLocation}
          readOnly={!editing}
          onChange={(v) => setDraft((d) => ({ ...d, keyLocation: v }))}
        />
        <AccessField
          label="Parking"
          placeholder="e.g. Park in spot #12 or on the street after 8am."
          value={editing ? draft.parkingNotes : parkingNotes}
          readOnly={!editing}
          onChange={(v) => setDraft((d) => ({ ...d, parkingNotes: v }))}
        />
      </div>
    </section>
  );
}

function AccessField({
  label,
  value,
  placeholder,
  readOnly,
  onChange,
  accent,
}: {
  label: string;
  value: string;
  placeholder?: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  accent?: "urgent";
}) {
  const tone =
    accent === "urgent"
      ? "border-rose-300/70 bg-rose-50/50 dark:bg-rose-950/20"
      : "border-[var(--border)] bg-[var(--background)]";
  return (
    <label className="block">
      <span
        className={`text-[10px] font-bold uppercase tracking-wider ${
          accent === "urgent" ? "text-rose-600" : "text-[var(--muted-foreground)]"
        }`}
      >
        {label}
      </span>
      {readOnly ? (
        <p
          className={`mt-1 min-h-[4.25rem] whitespace-pre-line rounded-md border px-3 py-2 text-sm ${tone} ${
            value ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)] italic"
          }`}
        >
          {value || "—"}
        </p>
      ) : (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={3}
          className={`mt-1 w-full rounded-md border px-3 py-2 text-sm ${tone} focus:outline-none focus:ring-2 focus:ring-[var(--ring)]`}
        />
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Extensible instructions list
// ---------------------------------------------------------------------------

function InstructionsCard({
  propertyId,
  instructions,
}: {
  propertyId: string;
  instructions: Instruction[];
}) {
  const { showToast } = useToast();
  const addInstruction = useMutation(api.properties.mutations.addInstruction);
  const updateInstruction = useMutation(api.properties.mutations.updateInstruction);
  const removeInstruction = useMutation(api.properties.mutations.removeInstruction);

  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      instructions.slice().sort((a, b) => {
        // Keep order stable by updatedAt ascending; "access" category floats to top
        if (a.category === "access" && b.category !== "access") return -1;
        if (b.category === "access" && a.category !== "access") return 1;
        return a.updatedAt - b.updatedAt;
      }),
    [instructions],
  );

  const handleAdd = async (draft: InstructionDraft) => {
    await addInstruction({
      propertyId: propertyId as Id<"properties">,
      category: draft.category,
      title: draft.en.title,
      body: draft.en.body,
      sourceLang: "en",
      translations: draft.es.title.trim() && draft.es.body.trim()
        ? { es: { title: draft.es.title, body: draft.es.body } }
        : undefined,
    });
    showToast("Instruction added.");
    setAddOpen(false);
  };

  const handleUpdate = async (id: string, draft: InstructionDraft) => {
    await updateInstruction({
      propertyId: propertyId as Id<"properties">,
      instructionId: id,
      category: draft.category,
      title: draft.en.title,
      body: draft.en.body,
      sourceLang: "en",
      translations: draft.es.title.trim() && draft.es.body.trim()
        ? { es: { title: draft.es.title, body: draft.es.body } }
        : undefined,
    });
    showToast("Instruction updated.");
    setEditingId(null);
  };

  const handleRemove = async (id: string) => {
    if (!confirm("Remove this instruction?")) return;
    try {
      await removeInstruction({
        propertyId: propertyId as Id<"properties">,
        instructionId: id,
      });
      showToast("Instruction removed.");
    } catch (error) {
      showToast(getErrorMessage(error, "Failed to remove instruction."), "error");
    }
  };

  return (
    <section className="rounded-2xl border bg-[var(--card)]">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Property instructions
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            Trash pickup, lawn care, hot tub, pool, Wi-Fi — anything a cleaner
            needs to know per-property.
          </p>
        </div>
        {!addOpen ? (
          <button
            onClick={() => {
              setEditingId(null);
              setAddOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            Add instruction
          </button>
        ) : null}
      </header>

      <div className="divide-y">
        {addOpen ? (
          <InstructionForm
            mode="create"
            onSubmit={handleAdd}
            onCancel={() => setAddOpen(false)}
          />
        ) : null}

        {sorted.length === 0 && !addOpen ? (
          <p className="px-4 py-8 text-center text-sm italic text-[var(--muted-foreground)]">
            No instructions yet. Add trash schedule, hot-tub tips, or anything
            else specific to this property.
          </p>
        ) : null}

        {sorted.map((instruction) =>
          editingId === instruction.id ? (
            <InstructionForm
              key={instruction.id}
              mode="edit"
              initial={{
                category: instruction.category,
                en: { title: instruction.title, body: instruction.body },
                es: instruction.translations?.es ?? { title: "", body: "" },
              }}
              onSubmit={(draft) => handleUpdate(instruction.id, draft)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <InstructionRow
              key={instruction.id}
              instruction={instruction}
              onEdit={() => {
                setAddOpen(false);
                setEditingId(instruction.id);
              }}
              onRemove={() => handleRemove(instruction.id)}
            />
          ),
        )}
      </div>
    </section>
  );
}

function InstructionRow({
  instruction,
  onEdit,
  onRemove,
}: {
  instruction: Instruction;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const meta = CATEGORY_BY_VALUE.get(instruction.category);
  const Icon = meta?.icon ?? Info;
  return (
    <article className="flex items-start gap-3 px-4 py-4">
      <span
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-[var(--background)] ${
          meta?.tint ?? "text-slate-500"
        }`}
      >
        <Icon className="h-4.5 w-4.5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{instruction.title}</h3>
          <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            {meta?.label ?? instruction.category}
          </span>
          {instruction.translations?.es ? (
            <span
              title="Spanish translation available"
              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              <Languages className="h-3 w-3" />
              ES
            </span>
          ) : (
            <span
              title="Translation pending — auto-generating"
              className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
            >
              <Languages className="h-3 w-3" />
              …
            </span>
          )}
        </div>
        <p className="mt-1 whitespace-pre-line text-sm text-[var(--muted-foreground)]">
          {instruction.body}
        </p>
        {instruction.translations?.es ? (
          <p className="mt-2 whitespace-pre-line border-l-2 border-emerald-300/60 pl-3 text-[13px] italic text-[var(--muted-foreground)]">
            <span className="text-[10px] font-bold uppercase tracking-wider not-italic text-emerald-600">ES</span>
            <br />
            {instruction.translations.es.body}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onEdit}
          aria-label="Edit instruction"
          className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={onRemove}
          aria-label="Remove instruction"
          className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

type InstructionDraft = {
  category: InstructionCategory;
  en: { title: string; body: string };
  es: { title: string; body: string };
};

function InstructionForm({
  mode,
  initial,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: InstructionDraft;
  onSubmit: (draft: InstructionDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const translate = useAction(api.translation.actions.translate);
  const [draft, setDraft] = useState<InstructionDraft>(
    initial ?? {
      category: "access",
      en: { title: "", body: "" },
      es: { title: "", body: "" },
    },
  );
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    draft.en.title.trim().length > 0 && draft.en.body.trim().length > 0;
  const canAutoTranslate = canSubmit && !translating;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(draft);
    } catch (e) {
      setError(getErrorMessage(e, "Failed to save instruction."));
    } finally {
      setSaving(false);
    }
  };

  const autoTranslate = async () => {
    if (!canAutoTranslate) return;
    setTranslating(true);
    setError(null);
    try {
      const [esTitle, esBody] = await Promise.all([
        translate({
          text: draft.en.title,
          sourceLang: "en",
          targetLang: "es",
        }),
        translate({
          text: draft.en.body,
          sourceLang: "en",
          targetLang: "es",
        }),
      ]);
      setDraft((d) => ({
        ...d,
        es: { title: esTitle, body: esBody },
      }));
    } catch (e) {
      setError(getErrorMessage(e, "Auto-translate failed."));
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div className="space-y-3 bg-[var(--accent)]/40 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Category
          </span>
          <select
            value={draft.category}
            onChange={(event) =>
              setDraft((d) => ({
                ...d,
                category: event.target.value as InstructionCategory,
              }))
            }
            className="mt-1 w-full rounded-md border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end justify-end">
          <button
            type="button"
            onClick={autoTranslate}
            disabled={!canAutoTranslate}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--primary)]/40 bg-[var(--primary)]/10 px-2.5 py-1.5 text-xs font-semibold text-[var(--primary)] hover:bg-[var(--primary)]/20 disabled:opacity-40"
            title="Fill the Spanish column using Gemini"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {translating ? "Translating..." : "Auto-translate to Spanish"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <LangColumn
          lang="EN (source)"
          accent="primary"
          title={draft.en.title}
          body={draft.en.body}
          onTitle={(title) =>
            setDraft((d) => ({ ...d, en: { ...d.en, title } }))
          }
          onBody={(body) => setDraft((d) => ({ ...d, en: { ...d.en, body } }))}
          titlePlaceholder="e.g. Front door code"
          bodyPlaceholder="Detailed instructions the cleaner will see."
        />
        <LangColumn
          lang="ES (translation)"
          accent="emerald"
          title={draft.es.title}
          body={draft.es.body}
          onTitle={(title) =>
            setDraft((d) => ({ ...d, es: { ...d.es, title } }))
          }
          onBody={(body) => setDraft((d) => ({ ...d, es: { ...d.es, body } }))}
          titlePlaceholder="p. ej. Código de la puerta principal"
          bodyPlaceholder="Instrucciones detalladas que verá el limpiador."
        />
      </div>

      <p className="text-[11px] text-[var(--muted-foreground)]">
        Leave Spanish blank and we&apos;ll auto-translate on save. Filling it
        in manually (or editing after auto-translate) preserves your wording.
      </p>

      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--accent)] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving || !canSubmit}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? "Saving..." : mode === "create" ? "Add" : "Save"}
        </button>
      </div>
    </div>
  );
}

function LangColumn({
  lang,
  accent,
  title,
  body,
  onTitle,
  onBody,
  titlePlaceholder,
  bodyPlaceholder,
}: {
  lang: string;
  accent: "primary" | "emerald";
  title: string;
  body: string;
  onTitle: (value: string) => void;
  onBody: (value: string) => void;
  titlePlaceholder?: string;
  bodyPlaceholder?: string;
}) {
  const tint =
    accent === "primary"
      ? "border-[var(--primary)]/40 bg-[var(--primary)]/5"
      : "border-emerald-300/60 bg-emerald-50/40 dark:bg-emerald-950/20";
  const badge =
    accent === "primary"
      ? "text-[var(--primary)]"
      : "text-emerald-700 dark:text-emerald-300";
  return (
    <div className={`space-y-2 rounded-lg border p-3 ${tint}`}>
      <span
        className={`text-[10px] font-bold uppercase tracking-wider ${badge}`}
      >
        {lang}
      </span>
      <input
        value={title}
        onChange={(event) => onTitle(event.target.value)}
        placeholder={titlePlaceholder}
        maxLength={80}
        className="block w-full rounded-md border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
      />
      <textarea
        value={body}
        onChange={(event) => onBody(event.target.value)}
        placeholder={bodyPlaceholder}
        rows={4}
        className="block w-full rounded-md border bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
      />
    </div>
  );
}
