interface Props {
  /** Pixel size of the icon. Defaults to 28 (header / sidebar use). */
  size?: number;
  /** Show the wordmark next to the icon. */
  withWordmark?: boolean;
  /** Tailwind text-size class for the wordmark when shown. */
  wordmarkClass?: string;
}

export function Logo({ size = 28, withWordmark = false, wordmarkClass = 'text-sm font-semibold tracking-tight text-slate-900' }: Props) {
  return (
    <span className="inline-flex items-center gap-2">
      <img
        src="/getmcp-icon.png"
        alt="GetMCP"
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="block select-none"
        draggable={false}
      />
      {withWordmark && <span className={wordmarkClass}>GetMCP</span>}
    </span>
  );
}
