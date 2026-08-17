type Props = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizes = {
  sm: "w-7 h-7 text-[10px] rounded",
  md: "w-8 h-8 text-[11px] rounded",
  lg: "w-10 h-10 text-[11px] rounded",
};

export function TdbLogo({ size = "md", className = "" }: Props) {
  return (
    <div
      className={`bg-gold-700 flex items-center justify-center text-white font-sans font-semibold tracking-tight leading-none shadow-xs ${sizes[size]} ${className}`}
    >
      TDB
    </div>
  );
}
