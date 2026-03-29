import * as React from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

// --- BUTTON ---
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "neon" | "destructive";
  size?: "sm" | "default" | "lg" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-xl font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          {
            "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/20": variant === "default",
            "border border-primary/50 text-primary hover:bg-primary/10": variant === "outline",
            "hover:bg-accent hover:text-accent-foreground": variant === "ghost",
            "bg-destructive text-destructive-foreground hover:bg-destructive/90": variant === "destructive",
            "bg-transparent border border-primary text-primary shadow-[0_0_15px_hsl(var(--primary)/0.3)_inset,0_0_15px_hsl(var(--primary)/0.3)] hover:shadow-[0_0_25px_hsl(var(--primary)/0.5)_inset,0_0_25px_hsl(var(--primary)/0.5)]": variant === "neon",
            "h-10 px-4 py-2": size === "default",
            "h-9 rounded-lg px-3": size === "sm",
            "h-12 rounded-xl px-8": size === "lg",
            "h-10 w-10": size === "icon",
          },
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

// --- INPUT ---
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-xl border border-border bg-background/50 px-3 py-2 text-sm text-foreground ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary transition-all",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

// --- TEXTAREA ---
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-xl border border-border bg-background/50 px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary transition-all",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

// --- CARD ---
export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-2xl glass-panel text-card-foreground", className)} {...props}>
      {children}
    </div>
  );
}

// --- BADGE ---
export function Badge({ className, variant = "default", children, ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "outline" | "accent" }) {
  return (
    <div className={cn(
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
      {
        "bg-primary/20 text-primary border border-primary/30": variant === "default",
        "border border-border text-foreground": variant === "outline",
        "bg-accent/20 text-accent border border-accent/30": variant === "accent",
      },
      className
    )} {...props}>
      {children}
    </div>
  );
}

// --- ANIMATED SPINNER ---
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin h-5 w-5", className)} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );
}

// --- PAGE ANIMATION WRAPPER ---
export function PageTransition({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn("w-full h-full", className)}
    >
      {children}
    </motion.div>
  );
}
