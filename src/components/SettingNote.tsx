/** A short explanation shown under an encoder setting. */
const SettingNote = ({ children }: { children: React.ReactNode }) => (
  <p className="mx-auto my-2 max-w-140 text-sm leading-relaxed text-slate-400">
    {children}
  </p>
);

export default SettingNote;
