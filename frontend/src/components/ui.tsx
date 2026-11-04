import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
    'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none',
    {
        variants: {
            variant: {
                default: 'bg-accent text-accent-ink hover:bg-accent/90',
                secondary: 'bg-surface-strong text-ink hover:bg-surface-strong/75',
                outline: 'border border-line bg-transparent text-ink hover:bg-surface-strong/60',
                ghost: 'text-ink hover:bg-surface-strong/60',
                danger: 'bg-danger text-white hover:bg-danger/90',
                quiet: 'text-muted hover:text-ink hover:bg-surface-strong/60',
            },
            size: {
                default: 'h-10 px-4',
                sm: 'h-8 px-3 text-xs',
                lg: 'h-11 px-5',
                icon: 'h-9 w-9 p-0',
                'icon-sm': 'h-8 w-8 p-0',
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    }
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
    VariantProps<typeof buttonVariants> & {
        asChild?: boolean;
    };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : 'button';
        return (
            <Comp
                ref={ref}
                className={cn(buttonVariants({ variant, size }), className)}
                {...props}
            />
        );
    }
);
Button.displayName = 'Button';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, ...props }, ref) => (
        <input
            ref={ref}
            className={cn(
                'h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20',
                className
            )}
            {...props}
        />
    )
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    ({ className, ...props }, ref) => (
        <textarea
            ref={ref}
            className={cn(
                'min-h-24 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20',
                className
            )}
            {...props}
        />
    )
);
Textarea.displayName = 'Textarea';

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
    ({ className, ...props }, ref) => (
        <label
            ref={ref}
            className={cn('text-xs font-semibold uppercase tracking-[0.14em] text-muted', className)}
            {...props}
        />
    )
);
Label.displayName = 'Label';

const badgeVariants = cva(
    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none',
    {
        variants: {
            variant: {
                default: 'bg-accent-soft text-accent',
                muted: 'bg-surface-strong text-muted',
                success: 'bg-success/10 text-success',
                warning: 'bg-warning/10 text-warning',
                danger: 'bg-danger-soft text-danger',
                outline: 'border border-line text-muted',
            },
        },
        defaultVariants: { variant: 'default' },
    }
);

export function Badge({
    className,
    variant,
    ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
    return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function Progress({
    value,
    className,
    indicatorClassName,
}: {
    value: number;
    className?: string;
    indicatorClassName?: string;
}) {
    return (
        <ProgressPrimitive.Root
            value={Math.max(0, Math.min(100, value))}
            className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-strong', className)}
        >
            <ProgressPrimitive.Indicator
                className={cn('h-full w-full flex-1 bg-accent transition-all', indicatorClassName)}
                style={{ transform: `translateX(-${100 - Math.max(0, Math.min(100, value))}%)` }}
            />
        </ProgressPrimitive.Root>
    );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('animate-pulse rounded-xl bg-surface-strong/70', className)} {...props} />;
}

export function Separator({
    className,
    orientation = 'horizontal',
    ...props
}: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
    return (
        <SeparatorPrimitive.Root
            orientation={orientation}
            className={cn(
                'shrink-0 bg-line',
                orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
                className
            )}
            {...props}
        />
    );
}

export const ScrollArea = React.forwardRef<
    React.ElementRef<typeof ScrollAreaPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
    <ScrollAreaPrimitive.Root ref={ref} className={cn('relative overflow-hidden', className)} {...props}>
        <ScrollAreaPrimitive.Viewport className='h-full w-full rounded-[inherit]'>
            {children}
        </ScrollAreaPrimitive.Viewport>
        <ScrollAreaPrimitive.Scrollbar
            orientation='vertical'
            className='flex touch-none select-none p-0.5'
        >
            <ScrollAreaPrimitive.Thumb className='relative flex-1 rounded-full bg-muted/30' />
        </ScrollAreaPrimitive.Scrollbar>
        <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = 'ScrollArea';

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
export const CollapsibleContent = CollapsiblePrimitive.Content;

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = React.forwardRef<
    React.ElementRef<typeof PopoverPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 8, ...props }, ref) => (
    <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
            ref={ref}
            align={align}
            sideOffset={sideOffset}
            className={cn(
                'z-50 w-72 rounded-2xl border border-line bg-surface p-3 text-ink shadow-lift outline-none',
                className
            )}
            {...props}
        />
    </PopoverPrimitive.Portal>
));
PopoverContent.displayName = 'PopoverContent';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
    React.ElementRef<typeof TooltipPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
    <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
            ref={ref}
            sideOffset={sideOffset}
            className={cn(
                'z-50 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-background shadow-soft',
                className
            )}
            {...props}
        />
    </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { wide?: boolean }
>(({ className, children, wide, ...props }, ref) => (
    <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className='fixed inset-0 z-50 bg-black/45 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out' />
        <DialogPrimitive.Content
            ref={ref}
            className={cn(
                'fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-line bg-surface shadow-lift outline-none',
                wide ? 'max-w-5xl' : 'max-w-lg',
                className
            )}
            {...props}
        >
            {children}
            <DialogPrimitive.Close className='absolute right-4 top-4 rounded-full p-2 text-muted transition-colors hover:bg-surface-strong hover:text-ink'>
                <X size={18} />
                <span className='sr-only'>Close</span>
            </DialogPrimitive.Close>
        </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('flex flex-col gap-1 px-6 pb-4 pt-6', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
    return (
        <DialogPrimitive.Title
            className={cn('text-xl font-semibold tracking-tight text-ink', className)}
            {...props}
        />
    );
}

export function DialogDescription({
    className,
    ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
    return <DialogPrimitive.Description className={cn('text-sm leading-6 text-muted', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('flex flex-wrap items-center justify-end gap-2 px-6 pb-6 pt-4', className)} {...props} />;
}

export const SheetContent = DialogContent;

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export const AlertDialogContent = React.forwardRef<
    React.ElementRef<typeof AlertDialogPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className='fixed inset-0 z-50 bg-black/45 backdrop-blur-sm' />
        <AlertDialogPrimitive.Content
            ref={ref}
            className={cn(
                'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-line bg-surface p-6 shadow-lift',
                className
            )}
            {...props}
        />
    </AlertDialogPrimitive.Portal>
));
AlertDialogContent.displayName = 'AlertDialogContent';

export function AlertDialogTitle({
    className,
    ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>) {
    return <AlertDialogPrimitive.Title className={cn('text-lg font-semibold', className)} {...props} />;
}

export function AlertDialogDescription({
    className,
    ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>) {
    return (
        <AlertDialogPrimitive.Description
            className={cn('mt-2 text-sm leading-6 text-muted', className)}
            {...props}
        />
    );
}

export function AlertDialogActions({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('mt-6 flex justify-end gap-2', className)} {...props} />;
}

export const AlertDialogAction = AlertDialogPrimitive.Action;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;

export function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('mt-6 flex flex-wrap justify-end gap-2', className)} {...props} />;
}

export function Switch({ className, ...props }: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
    return (
        <SwitchPrimitive.Root
            className={cn(
                'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-surface-strong transition-colors data-[state=checked]:bg-accent',
                className
            )}
            {...props}
        >
            <SwitchPrimitive.Thumb className='pointer-events-none block h-5 w-5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0' />
        </SwitchPrimitive.Root>
    );
}

export const Tabs = TabsPrimitive.Root;
export const TabsList = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.List>,
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
    <TabsPrimitive.List
        ref={ref}
        className={cn('inline-flex items-center gap-1 rounded-xl bg-surface-strong/60 p-1', className)}
        {...props}
    />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.Trigger>,
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
    <TabsPrimitive.Trigger
        ref={ref}
        className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-semibold text-muted transition-colors data-[state=active]:bg-surface data-[state=active]:text-ink',
            className
        )}
        {...props}
    />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = TabsPrimitive.Content;
