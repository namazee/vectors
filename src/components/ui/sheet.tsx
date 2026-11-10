"use client";
import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;

function SheetContent({
  className,
  children,
  side = "left",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: "left" | "right" }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <SheetPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex h-full w-[85%] max-w-xs flex-col bg-background shadow-lg data-[state=open]:animate-in data-[state=open]:duration-300",
          side === "left" ? "left-0 border-r data-[state=open]:slide-in-from-left" : "right-0 border-l data-[state=open]:slide-in-from-right",
          className,
        )}
        {...props}
      >
        <SheetPrimitive.Title className="sr-only">Menu</SheetPrimitive.Title>
        {children}
        <SheetPrimitive.Close className="absolute top-3 right-3 rounded-xs opacity-70 hover:opacity-100">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
export { Sheet, SheetTrigger, SheetClose, SheetContent };
