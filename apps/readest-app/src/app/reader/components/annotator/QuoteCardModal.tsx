import React, { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { FiCopy, FiDownload, FiShare } from 'react-icons/fi';
import { cn } from '@/utils/tailwind';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { eventDispatcher } from '@/utils/event';
import Dialog from '@/components/Dialog';

type QuoteThemeId = 'minimal-light' | 'minimal-dark' | 'warm-sepia';
type AspectRatioId = 'portrait' | 'square' | 'landscape';

interface QuoteTheme {
  id: QuoteThemeId;
  name: string;
  background: string;
  text: string;
  accent: string;
}

const QUOTE_THEMES: Record<QuoteThemeId, QuoteTheme> = {
  'minimal-light': {
    id: 'minimal-light',
    name: 'Minimal Light',
    background: '#f4ecdd',
    text: '#232323',
    accent: '#8b6f47',
  },
  'minimal-dark': {
    id: 'minimal-dark',
    name: 'Minimal Dark',
    background: '#14110e',
    text: '#ede6da',
    accent: '#c9b184',
  },
  'warm-sepia': {
    id: 'warm-sepia',
    name: 'Warm Sepia',
    background: '#efe5c9',
    text: '#5b4636',
    accent: '#8b6f47',
  },
};

const ASPECT_RATIOS: Record<AspectRatioId, { name: string; width: number; height: number }> = {
  portrait: { name: 'Portrait', width: 1080, height: 1350 },
  square: { name: 'Square', width: 1080, height: 1080 },
  landscape: { name: 'Landscape', width: 1080, height: 810 },
};

const FONT_SIZES = ['S', 'M', 'L'] as const;
type FontSize = (typeof FONT_SIZES)[number];

// Retina-crisp raster: 2x minimum, 3x used for share/download.
const EXPORT_PIXEL_RATIO = 3;

const SERIF_STACK =
  'Bitter, Literata, Merriweather, "Roboto Slab", Vollkorn, "PT Serif", Georgia, "Times New Roman", serif';

interface QuoteCardModalProps {
  quoteText: string;
  bookTitle: string;
  author: string;
  onClose: () => void;
}

const QuoteCardModal: React.FC<QuoteCardModalProps> = ({
  quoteText,
  bookTitle,
  author,
  onClose,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();

  const [themeId, setThemeId] = useState<QuoteThemeId>('warm-sepia');
  const [ratioId, setRatioId] = useState<AspectRatioId>('portrait');
  const [fontSize, setFontSize] = useState<FontSize>('M');

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [exporting, setExporting] = useState(false);

  const theme = QUOTE_THEMES[themeId];
  const ratio = ASPECT_RATIOS[ratioId];

  const renderCard = async (pixelRatio: number): Promise<Blob> => {
    const node = cardRef.current;
    if (!node) throw new Error(_('Card image is not available yet.'));
    const dataUrl = await toPng(node, {
      pixelRatio,
      backgroundColor: theme.background,
      cacheBust: true,
      style: { fontFamily: SERIF_STACK },
    });
    return await fetch(dataUrl).then((res) => res.blob());
  };

  const cardFileName = (): string => {
    const base = makeSafeName(bookTitle || 'readest-quote');
    return `${base}-quote-card.png`;
  };

  const blobToArrayBuffer = async (blob: Blob): Promise<ArrayBuffer> => {
    const url = URL.createObjectURL(blob);
    const buf = await fetch(url).then((res) => res.arrayBuffer());
    URL.revokeObjectURL(url);
    return buf;
  };

  const toast = (type: 'info' | 'success' | 'error', message: string) => {
    eventDispatcher.dispatch('toast', { type, message });
  };

  const handleShare = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await renderCard(EXPORT_PIXEL_RATIO);
      const file = [new File([blob], cardFileName(), { type: 'image/png' })] satisfies File[];
      const shareText = `${quoteText} — ${author}`;

      // Native sharekit on mobile/macOS.
      if (appService?.isMobileApp || appService?.isMacOSApp) {
        const buf = await blobToArrayBuffer(blob);
        const saved = await appService.saveFile(cardFileName(), buf, {
          mimeType: 'image/png',
          share: true,
        });
        toast(saved ? 'success' : 'error', saved ? _('Shared quote card') : _('Share failed'));
        return;
      }

      // Web Share API with files.
      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: file })
      ) {
        try {
          await navigator.share({
            files: file,
            title: bookTitle,
            text: shareText,
          });
          toast('success', _('Shared quote card'));
          return;
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return;
        }
      }

      // Fallback: copy the image so the user still ends up with the card.
      await handleCopyImage(blob);
    } catch (err) {
      console.error('Share quote card failed:', err);
      toast('error', _('Failed to create quote card'));
    } finally {
      setExporting(false);
    }
  };

  const handleCopyImage = async (blobOverride?: Blob) => {
    try {
      const blob = blobOverride ?? (await renderCard(EXPORT_PIXEL_RATIO));
      if (typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('success', _('Quote card copied'));
        return;
      }
      toast('error', _('Copying images is not supported on this browser'));
    } catch (err) {
      console.error('Copy quote card failed:', err);
      toast('error', _('Failed to copy quote card'));
    }
  };

  const handleDownload = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await renderCard(EXPORT_PIXEL_RATIO);
      if (appService) {
        const buf = await blobToArrayBuffer(blob);
        const saved = await appService.saveFile(cardFileName(), buf, { mimeType: 'image/png' });
        if (!saved) {
          toast('error', _('Failed to save quote card'));
          return;
        }
        toast('success', _('Quote card saved'));
        return;
      }
      // Web fallback: direct download.
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = cardFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast('success', _('Downloaded quote card'));
    } catch (err) {
      console.error('Download quote card failed:', err);
      toast('error', _('Failed to create quote card'));
    } finally {
      setExporting(false);
    }
  };

  const focusRing =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/20';

  const themeDots = Object.values(QUOTE_THEMES).map((t) => (
    <button
      key={t.id}
      type='button'
      aria-label={`${t.name} ${_('theme')}`}
      aria-pressed={t.id === themeId}
      onClick={() => setThemeId(t.id)}
      className={cn(
        'eink-bordered flex h-10 w-10 items-center justify-center rounded-full border transition-colors',
        focusRing,
        t.id === themeId && 'ring-2 ring-offset-1 ring-offset-base-100 not-eink:ring-primary',
      )}
      style={{ backgroundColor: t.background }}
    >
      <span className='h-3 w-3 rounded-full' style={{ backgroundColor: t.text }} />
    </button>
  ));

  const ratioPills = (Object.keys(ASPECT_RATIOS) as AspectRatioId[]).map((id) => (
    <button
      key={id}
      type='button'
      onClick={() => setRatioId(id)}
      aria-pressed={ratioId === id}
      className={cn(
        'eink-bordered min-h-10 rounded-md px-3 text-xs transition-colors sm:min-h-8',
        focusRing,
        ratioId === id ? 'not-eink:bg-primary not-eink:text-primary-content' : 'bg-base-200',
      )}
    >
      {_(ASPECT_RATIOS[id].name)}
    </button>
  ));

  const fontSizePills = FONT_SIZES.map((size) => (
    <button
      key={size}
      type='button'
      onClick={() => setFontSize(size)}
      aria-pressed={fontSize === size}
      className={cn(
        'eink-bordered min-h-10 w-10 rounded-md text-xs transition-colors sm:min-h-8',
        focusRing,
        fontSize === size ? 'not-eink:bg-primary not-eink:text-primary-content' : 'bg-base-200',
      )}
    >
      {size}
    </button>
  ));

  const ratioFontScale: Record<AspectRatioId, number> = {
    portrait: 1,
    square: 0.9,
    landscape: 0.85,
  };
  const fontSizeScale: Record<FontSize, number> = { S: 0.85, M: 1, L: 1.2 };
  const fontScale = ratioFontScale[ratioId] * fontSizeScale[fontSize];

  return (
    <Dialog isOpen title={_('Quote Card')} onClose={onClose}>
      <div className='flex flex-col gap-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:p-4'>
        <p className='text-sm leading-relaxed text-base-content/70'>
          {_('Turn this passage into a shareable reading card.')}
        </p>
        <div
          ref={cardRef}
          style={{
            width: '100%',
            aspectRatio: `${ratio.width} / ${ratio.height}`,
            backgroundColor: theme.background,
            color: theme.text,
            fontFamily: SERIF_STACK,
            borderRadius: 16,
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <span
            className='pointer-events-none select-none'
            style={{
              position: 'absolute',
              top: 12,
              insetInlineStart: 24,
              fontSize: 88 * fontScale,
              lineHeight: 1,
              color: theme.accent,
              opacity: 0.5,
            }}
            aria-hidden='true'
          >
            &ldquo;
          </span>
          <div
            style={{
              padding: `${48 * fontScale}px ${40 * fontScale}px`,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              height: '100%',
            }}
          >
            <blockquote
              style={{
                margin: 0,
                fontSize: 26 * fontScale,
                lineHeight: 1.5,
                letterSpacing: 0.2,
                fontWeight: 400,
                textAlign: 'start',
              }}
            >
              {quoteText}
            </blockquote>
            <footer
              style={{
                marginTop: 32 * fontScale,
                paddingTop: 16 * fontScale,
                borderTop: `1px solid ${theme.accent}33`,
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'center',
                gap: 12,
                fontSize: 14 * fontScale,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  minWidth: 0,
                  maxWidth: '88%',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span style={{ overflowWrap: 'anywhere', fontWeight: 600 }}>
                  {bookTitle || _('Untitled book')}
                </span>
                {author && (
                  <span style={{ overflowWrap: 'anywhere', color: theme.accent }}>{author}</span>
                )}
              </div>
            </footer>
          </div>
          <span
            className='pointer-events-none select-none'
            style={{
              position: 'absolute',
              bottom: 10,
              insetInlineEnd: 18,
              fontSize: 10 * fontScale,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              color: theme.accent,
              opacity: 0.7,
            }}
          >
            {_('Readest')}
          </span>
        </div>

        <div className='eink-bordered flex flex-col gap-1 rounded-lg border border-base-200 bg-base-100 p-3'>
          <span className='mb-1 text-sm font-semibold'>{_('Customize')}</span>
          <fieldset className='flex flex-wrap items-center justify-between gap-2 py-1'>
            <legend className='text-sm text-base-content/70'>{_('Theme')}</legend>
            <div className='flex gap-2' role='group' aria-label={_('Theme')}>
              {themeDots}
            </div>
          </fieldset>
          <fieldset className='flex flex-wrap items-center justify-between gap-2 py-1'>
            <legend className='text-sm text-base-content/70'>{_('Format')}</legend>
            <div className='flex flex-wrap gap-1' role='group' aria-label={_('Format')}>
              {ratioPills}
            </div>
          </fieldset>
          <fieldset className='flex flex-wrap items-center justify-between gap-2 py-1'>
            <legend className='text-sm text-base-content/70'>{_('Quote size')}</legend>
            <div className='flex gap-1' role='group' aria-label={_('Quote size')}>
              {fontSizePills}
            </div>
          </fieldset>
        </div>

        <div className='mt-1 flex flex-col gap-2'>
          <button
            type='button'
            onClick={handleShare}
            disabled={exporting}
            className='btn btn-contrast w-full gap-2'
          >
            <FiShare aria-hidden='true' />
            {exporting ? _('Preparing…') : _('Share')}
          </button>
          <div className='grid grid-cols-2 gap-2'>
            <button
              type='button'
              onClick={() => void handleCopyImage()}
              disabled={exporting}
              className='btn btn-ghost eink-bordered gap-2'
            >
              <FiCopy aria-hidden='true' />
              {_('Copy Image')}
            </button>
            <button
              type='button'
              onClick={() => void handleDownload()}
              disabled={exporting}
              className='btn btn-ghost eink-bordered gap-2'
            >
              <FiDownload aria-hidden='true' />
              {_('Download PNG')}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};

function makeSafeName(name: string): string {
  const cleaned = name
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return cleaned || 'readest';
}

export default QuoteCardModal;
