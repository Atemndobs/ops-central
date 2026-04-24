type SystemMessageCardProps = {
  label: string;
  children: React.ReactNode;
};

export function SystemMessageCard({ label, children }: SystemMessageCardProps) {
  return (
    <div className="mx-auto my-1 w-full max-w-[520px] rounded-xl border border-[var(--msg-divider)] bg-[var(--msg-surface)] px-3 py-2.5 text-center">
      <p
        className="msg-label mb-1"
        style={{ color: "var(--msg-internal-fg)" }}
      >
        {label}
      </p>
      <p className="text-[13px] text-[var(--msg-text-dim)]">{children}</p>
    </div>
  );
}
