import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../../../utils/cn.ts';

export interface FollowUpPaginationProps {
  canGoPrevious: boolean;
  canGoNext: boolean;
  submitting: boolean;
  isFrozen: boolean;
  currentLabel: string;
  totalLabel: string;
  handleGoPrevious: () => void;
  handleGoNext: () => void;
}

export default function FollowUpPagination({
  canGoPrevious,
  canGoNext,
  submitting,
  isFrozen,
  currentLabel,
  totalLabel,
  handleGoPrevious,
  handleGoNext,
}: FollowUpPaginationProps) {
  const prevDisabled = !canGoPrevious || submitting || isFrozen;
  const nextActive = canGoNext && !submitting && !isFrozen;

  return (
    <div className="grid grid-cols-[56px_1fr_56px] items-center gap-2.5 border-t border-t-line-subtle pt-2">
      <button
        type="button"
        disabled={prevDisabled}
        onClick={handleGoPrevious}
        className={cn(
          'h-[34px] rounded-lg border border-line bg-transparent',
          prevDisabled ? 'cursor-not-allowed opacity-50 text-muted' : 'cursor-pointer text-primary',
        )}
      >
        <ChevronLeft size={16} />
      </button>
      <div className="flex items-center justify-center gap-2">
        <span className="inline-block h-1 w-1 rounded-full bg-accent" />
        <span className="text-base font-bold tracking-[0.4px] text-primary">{`${currentLabel} / ${totalLabel}`}</span>
        <span className="inline-block h-1 w-1 rounded-full bg-accent" />
      </div>
      <button
        type="button"
        disabled={!canGoNext || submitting || isFrozen}
        onClick={handleGoNext}
        className={cn(
          'h-[34px] rounded-lg border border-line bg-transparent',
          nextActive ? 'cursor-pointer text-primary' : 'cursor-not-allowed opacity-50 text-muted',
        )}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
