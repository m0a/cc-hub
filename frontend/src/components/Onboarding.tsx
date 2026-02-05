import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const ONBOARDING_KEY = 'cchub-onboarding-completed';

interface SpotlightStep {
  // CSS selector for the target element
  target: string;
  // Translation keys
  titleKey: string;
  descriptionKey: string;
  // Tooltip position relative to target
  position: 'top' | 'bottom' | 'left' | 'right';
}

const steps: SpotlightStep[] = [
  {
    target: '[data-onboarding="terminal"]',
    titleKey: 'onboarding.step1Title',
    descriptionKey: 'onboarding.step1Description',
    position: 'bottom',
  },
  {
    target: '[data-onboarding="session-list"]',
    titleKey: 'onboarding.step2Title',
    descriptionKey: 'onboarding.step2Description',
    position: 'left',
  },
  {
    target: '[data-onboarding="dashboard"]',
    titleKey: 'onboarding.step3Title',
    descriptionKey: 'onboarding.step3Description',
    position: 'left',
  },
  {
    target: '[data-onboarding="file-browser"]',
    titleKey: 'onboarding.step4Title',
    descriptionKey: 'onboarding.step4Description',
    position: 'bottom',
  },
  {
    target: '[data-onboarding="conversation"]',
    titleKey: 'onboarding.step5Title',
    descriptionKey: 'onboarding.step5Description',
    position: 'bottom',
  },
];

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<SpotlightRect | null>(null);
  const [isReady, setIsReady] = useState(false);

  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  // Find and measure the target element
  const updateTargetRect = useCallback(() => {
    const element = document.querySelector(step.target);
    if (element) {
      const rect = element.getBoundingClientRect();
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
      setIsReady(true);
    } else {
      // Element not found, skip to next step or complete
      if (currentStep < steps.length - 1) {
        setCurrentStep(prev => prev + 1);
      } else {
        handleComplete();
      }
    }
  }, [step.target, currentStep]);

  // Update target rect on step change and window resize
  useEffect(() => {
    setIsReady(false);
    // Small delay to let the UI render
    const timer = setTimeout(updateTargetRect, 100);

    window.addEventListener('resize', updateTargetRect);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateTargetRect);
    };
  }, [updateTargetRect]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleSkip = () => {
    handleComplete();
  };

  const handleComplete = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    onComplete();
  };

  // Calculate tooltip position
  const getTooltipStyle = (): React.CSSProperties => {
    if (!targetRect) return { opacity: 0 };

    const padding = 16;
    const tooltipWidth = 280;
    const tooltipHeight = 180; // Approximate

    let top = 0;
    let left = 0;

    switch (step.position) {
      case 'top':
        top = targetRect.top - tooltipHeight - padding;
        left = targetRect.left + (targetRect.width - tooltipWidth) / 2;
        break;
      case 'bottom':
        top = targetRect.top + targetRect.height + padding;
        left = targetRect.left + (targetRect.width - tooltipWidth) / 2;
        break;
      case 'left':
        top = targetRect.top + (targetRect.height - tooltipHeight) / 2;
        left = targetRect.left - tooltipWidth - padding;
        break;
      case 'right':
        top = targetRect.top + (targetRect.height - tooltipHeight) / 2;
        left = targetRect.left + targetRect.width + padding;
        break;
    }

    // Keep tooltip within viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (left < padding) left = padding;
    if (left + tooltipWidth > viewportWidth - padding) {
      left = viewportWidth - tooltipWidth - padding;
    }
    if (top < padding) top = padding;
    if (top + tooltipHeight > viewportHeight - padding) {
      top = viewportHeight - tooltipHeight - padding;
    }

    return {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      width: `${tooltipWidth}px`,
      zIndex: 10001,
      opacity: isReady ? 1 : 0,
      transition: 'opacity 0.2s ease-in-out',
    };
  };

  if (!isReady && !targetRect) {
    // Show loading state briefly
    return (
      <div className="fixed inset-0 bg-black/70 z-[10000] flex items-center justify-center">
        <div className="text-white">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <>
      {/* Overlay with spotlight hole */}
      <div
        className="fixed inset-0 z-[10000] pointer-events-auto"
        onClick={handleNext}
      >
        <svg width="100%" height="100%" className="absolute inset-0">
          <defs>
            <mask id="spotlight-mask">
              <rect width="100%" height="100%" fill="white" />
              {targetRect && (
                <rect
                  x={targetRect.left - 4}
                  y={targetRect.top - 4}
                  width={targetRect.width + 8}
                  height={targetRect.height + 8}
                  rx="8"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.75)"
            mask="url(#spotlight-mask)"
          />
        </svg>

        {/* Highlight border around target */}
        {targetRect && (
          <div
            className="absolute border-2 border-blue-400 rounded-lg pointer-events-none animate-pulse"
            style={{
              top: targetRect.top - 4,
              left: targetRect.left - 4,
              width: targetRect.width + 8,
              height: targetRect.height + 8,
            }}
          />
        )}
      </div>

      {/* Tooltip */}
      <div
        style={getTooltipStyle()}
        className="bg-gray-800 rounded-xl shadow-2xl overflow-hidden pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress indicator */}
        <div className="flex gap-1 p-3 justify-center bg-gray-900/50">
          {steps.map((_, index) => (
            <div
              key={index}
              className={`h-1 rounded-full transition-all ${
                index === currentStep
                  ? 'w-6 bg-blue-500'
                  : index < currentStep
                  ? 'w-2 bg-blue-400'
                  : 'w-2 bg-gray-600'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="px-4 py-3">
          <h2 className="text-lg font-bold text-white mb-2">
            {t(step.titleKey)}
          </h2>
          <p className="text-gray-300 text-sm leading-relaxed">
            {t(step.descriptionKey)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 p-3 border-t border-gray-700">
          <button
            onClick={handleSkip}
            className="flex-1 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            {t('onboarding.skip')}
          </button>
          <button
            onClick={handleNext}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {isLastStep ? t('onboarding.start') : t('onboarding.next')}
          </button>
        </div>
      </div>
    </>
  );
}

export function useOnboarding() {
  // Check localStorage synchronously to avoid flash
  const [showOnboarding, setShowOnboarding] = useState(() => {
    const completed = localStorage.getItem(ONBOARDING_KEY);
    return !completed;
  });

  const completeOnboarding = () => {
    setShowOnboarding(false);
  };

  const resetOnboarding = () => {
    localStorage.removeItem(ONBOARDING_KEY);
    setShowOnboarding(true);
  };

  return { showOnboarding, completeOnboarding, resetOnboarding };
}
