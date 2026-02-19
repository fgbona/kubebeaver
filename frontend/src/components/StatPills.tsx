import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatPill {
  label: string;
  value: string | number;
  variant?: "default" | "secondary" | "outline";
}

interface StatPillsProps {
  items: StatPill[];
  className?: string;
}

export function StatPills({ items, className }: StatPillsProps) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {items.map((item, idx) => (
        <Badge key={idx} variant={item.variant || "secondary"}>
          <span className="font-medium">{item.label}:</span>{" "}
          <span className="ml-1">{item.value}</span>
        </Badge>
      ))}
    </div>
  );
}
