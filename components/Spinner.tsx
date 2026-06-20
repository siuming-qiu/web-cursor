export default function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={
        "inline-block w-3 h-3 rounded-full border-2 border-[#3a4150] border-t-accent animate-spin align-[-2px] " +
        className
      }
    />
  );
}
