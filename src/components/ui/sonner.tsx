"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// Toasts share the app's glass surface: translucent near-black, hairline edge,
// rim highlight, soft tinted shadow. Semantic color lives in the icon only.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="top-center"
      offset={16}
      gap={10}
      icons={{
        success: <CircleCheckIcon className="size-4 text-primary" />,
        info: <InfoIcon className="size-4 text-white/70" />,
        warning: <TriangleAlertIcon className="size-4 text-amber-300" />,
        error: <OctagonXIcon className="size-4 text-rose-400" />,
        loading: <Loader2Icon className="size-4 animate-spin text-white/70" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-start gap-3 rounded-2xl border border-white/10 bg-[rgba(18,18,22,0.85)] px-4 py-3.5 font-sans text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_20px_40px_-20px_rgba(74,222,128,0.18),0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-xl",
          icon: "mt-0.5 shrink-0",
          content: "min-w-0 flex-1",
          title: "text-sm font-medium leading-snug text-white",
          description: "mt-0.5 text-sm leading-snug text-white/50",
          actionButton:
            "ml-auto shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black",
          cancelButton:
            "ml-auto shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-white/70",
          closeButton: "text-white/40 hover:text-white",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
