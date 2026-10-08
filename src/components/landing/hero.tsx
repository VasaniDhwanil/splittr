'use client';

import Link from 'next/link';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { BillPreview } from './bill-preview';

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
};

export function Hero() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="pt-12 pb-20 sm:pt-20 lg:pt-24 lg:pb-28">
      <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
        <motion.div
          className="lg:col-span-5"
          variants={container}
          initial={reduceMotion ? false : 'hidden'}
          animate="show"
        >
          <motion.p
            variants={item}
            className="mb-4 inline-block bg-gradient-to-r from-emerald-300 via-green-400 to-lime-300 bg-clip-text pb-1 text-2xl font-semibold tracking-tight text-transparent md:text-3xl"
          >
            Splittr
          </motion.p>
          <motion.h1
            variants={item}
            className="text-4xl font-semibold leading-[1.05] tracking-[-0.02em] text-balance text-white md:text-5xl lg:text-6xl"
          >
            Pay for what you ordered.
          </motion.h1>
          <motion.p variants={item} className="mt-6 max-w-md text-lg leading-relaxed text-white/55">
            Scan the receipt, share a link, and everyone taps their items. Tax and tip are split fairly.
          </motion.p>
          <motion.div variants={item} className="mt-9 flex flex-wrap gap-3">
            <Button asChild size="lg" className="px-7">
              <Link href="/create">Split a Bill</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="ghost"
              className="border border-white/10 px-7 text-white hover:bg-white/[0.06] hover:text-white"
            >
              <Link href="/join">Join a Bill</Link>
            </Button>
          </motion.div>
        </motion.div>

        <motion.div
          className="relative isolate lg:col-span-7 lg:pl-6"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut', delay: 0.18 }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-16 -top-10 -bottom-10 -z-10 rounded-full blur-3xl"
            style={{
              background:
                'radial-gradient(ellipse at center, rgba(74, 222, 128, 0.22), rgba(74, 222, 128, 0.08) 35%, transparent 60%)',
            }}
          />
          <BillPreview className="mx-auto max-w-lg lg:mr-0" />
        </motion.div>
      </div>
    </section>
  );
}
