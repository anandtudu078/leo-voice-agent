import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  asChild?: boolean;
}

export const Input = React.forwardRef<HTMLElement, InputProps>(({ className, ...props }, ref) => {
  const classNameString = cn(
    "flex h-10 w-full rounded-md border border-input bg-background p-2 pl-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    className,
  );

  return (
    <input
      className={classNameString}
      ref={ref}
      {...props}
    />
  );
});

Input.displayName = "Input";