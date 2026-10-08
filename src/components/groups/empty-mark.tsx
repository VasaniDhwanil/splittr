import Image from 'next/image';

/** The brand mark at half strength, set above an empty state's text. */
export function EmptyMark({ className = 'mb-3' }: { className?: string }) {
  return (
    <Image
      src="/icon.svg"
      alt=""
      width={40}
      height={40}
      unoptimized
      className={`rounded-[10px] opacity-50 ${className}`}
    />
  );
}
