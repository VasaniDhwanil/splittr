import Image from 'next/image';
import Link from 'next/link';

export function Wordmark() {
  return (
    <Link
      href="/"
      className="inline-flex shrink-0 items-center gap-2 rounded-full text-[15px] font-semibold tracking-tight text-white"
    >
      <Image src="/icon.svg" alt="" width={20} height={20} unoptimized className="rounded-[5px]" />
      Splittr
    </Link>
  );
}
