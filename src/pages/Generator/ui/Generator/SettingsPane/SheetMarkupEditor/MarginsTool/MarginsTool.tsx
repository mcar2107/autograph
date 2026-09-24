import { Button } from '@shared/ui/Button';
import type { FC } from 'react';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import type { MarginLineSide, SheetPoint } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import type { MarkupMoveSource } from '../MarkupHandle';
import { MarkupHandle } from '../MarkupHandle';
import { toPointsAttribute } from '../MarkupOverlay/markupGeometry';
import { MarkupStroke } from '../MarkupStroke';
import type { MarkupToolProps } from '../SheetMarkupEditor.types';

import { resolveMarginHandles } from './marginsGeometry';
import type { MarginSide } from './marginsGeometry.types';
import { useMarginsEdit } from './useMarginsEdit';

const MARGIN_SIDES: MarginSide[] = ['top', 'bottom', 'left', 'right'];

/**
 * Поля, общие у листа и зеркальной страницы: боковые поля и линия поля у
 * зеркала свои и правятся в его разделе.
 */
const SHARED_MARGIN_SIDES: MarginSide[] = ['top', 'bottom'];

const MARGIN_LABELS: Record<MarginSide, string> = {
  top: 'Верхнее поле',
  bottom: 'Нижнее поле',
  left: 'Левое поле',
  right: 'Правое поле',
};

const MARGIN_LINE_SIDE_LABELS: Record<MarginLineSide, string> = {
  left: 'слева',
  right: 'справа',
};

/**
 * Толщина направляющих верхнего и нижнего полей в экранных пикселях.
 */
const GUIDE_WIDTH = 2;

/**
 * Инструмент «Поля»: четыре поля и линия поля — направляющими. Верхняя и
 * нижняя при отпускании встают на ближайшую линию разлиновки, боковые стоят,
 * где отпущены. Линию поля можно убрать и добавить: добавленная появляется у
 * ближайшей стороны листа и сразу идёт за указателем. Отпущенная, она
 * притягивается к черте фотографии, а сторона листа выводится из её
 * положения относительно середины листа.
 *
 * На зеркальной странице правятся только верхнее и нижнее поля — в
 * отражённом слое ручек, общие с листом. Боковые поля и линия поля у зеркала
 * свои: их задают в разделе зеркальной страницы.
 */
export const MarginsTool: FC<MarkupToolProps> = (props) => {
  const { handleLayer, pageIndex } = props;
  const isMirrorPage = pageIndex !== 0;
  const record = useMarkupEditorStore((state) => {
    return state.record;
  });
  const draft = useMarkupEditorStore((state) => {
    return state.draft;
  });
  const width = record?.sheet.width || 0;
  const height = record?.sheet.height || 0;
  const frame = useMemo(() => {
    return { width, height };
  }, [width, height]);
  const {
    isFollowing,
    moveMargin,
    releaseMargin,
    moveMarginLine,
    releaseMarginLine,
    removeMarginLine,
    addMarginLine,
  } = useMarginsEdit(frame, pageIndex === 0 ? handleLayer : null);

  if (!draft) {
    return null;
  }

  const { ruling } = draft;
  const { marginLineSide } = ruling;
  const handles = resolveMarginHandles(ruling, frame);
  const { marginLine } = handles;
  const guides = [
    { side: 'top', points: handles.topGuide },
    { side: 'bottom', points: handles.bottomGuide },
  ];

  const handleRemoveMarginLineClick = () => {
    removeMarginLine();
  };

  const handleAddMarginLineClick = () => {
    addMarginLine();
  };

  const handleMarginLineMove = (point: SheetPoint) => {
    moveMarginLine(point);
  };

  /**
   * Стрелкой линию поля сдвигают на пиксель мимо черты — магнит вернул бы
   * её обратно.
   *
   * @param point — точка отпускания, px фотографии
   * @param source — чем сдвинули
   */
  const handleMarginLineMoveEnd = (point: SheetPoint, source: MarkupMoveSource) => {
    releaseMarginLine(point, source === 'pointer');
  };

  const marginHandles = (isMirrorPage ? SHARED_MARGIN_SIDES : MARGIN_SIDES).map(
    (side) => {
      const { x, y } = handles[side];

      const handleMarginMove = (point: SheetPoint) => {
        moveMargin(side, point);
      };

      const handleMarginMoveEnd = (point: SheetPoint) => {
        releaseMargin(side, point);
      };

      return (
        <MarkupHandle
          key={side}
          x={x}
          y={y}
          label={MARGIN_LABELS[side]}
          className="in-data-pan-mode:pointer-events-none"
          onMove={handleMarginMove}
          onMoveEnd={handleMarginMoveEnd}
        />
      );
    }
  );

  return (
    <section aria-label="Поля листа" className="flex flex-col gap-2 text-sm">
      <p className="text-fg-muted">
        Перетащите направляющие полей: верхняя и нижняя встанут на ближайшую линию,
        боковые — куда отпустите. Текст не заходит за поля и отступает от линии поля.
      </p>

      {isMirrorPage ? (
        <p className="text-fg-muted">
          Боковые поля и линия поля зеркальной страницы задаются в её разделе ниже.
        </p>
      ) : (
        <>
          {marginLineSide === null ? (
            <p className="text-fg-muted">Линии поля нет.</p>
          ) : (
            <p className="text-fg">
              Линия поля {MARGIN_LINE_SIDE_LABELS[marginLineSide]}.
            </p>
          )}

          {isFollowing ? (
            <p role="status" className="text-fg-muted">
              Ведите линию поля к черте на фотографии и нажмите, чтобы поставить.
            </p>
          ) : null}

          {ruling.marginLineX === null ? (
            <Button variant="secondary" onClick={handleAddMarginLineClick}>
              Добавить линию поля
            </Button>
          ) : (
            <Button variant="secondary" onClick={handleRemoveMarginLineClick}>
              Убрать линию поля
            </Button>
          )}
        </>
      )}

      {handleLayer
        ? createPortal(
            <g data-tool="margins">
              <MarkupStroke
                pointerEvents="none"
                fill="none"
                width={GUIDE_WIDTH}
                className="stroke-markup-margin"
              >
                {guides.map(({ side, points }) => {
                  return (
                    <polyline
                      key={side}
                      data-margin-guide={side}
                      points={toPointsAttribute(points)}
                    />
                  );
                })}
              </MarkupStroke>

              {marginHandles}

              {marginLine && !isMirrorPage ? (
                <MarkupHandle
                  x={marginLine.x}
                  y={marginLine.y}
                  label="Линия поля"
                  className="stroke-danger in-data-pan-mode:pointer-events-none"
                  onMove={handleMarginLineMove}
                  onMoveEnd={handleMarginLineMoveEnd}
                />
              ) : null}
            </g>,
            handleLayer
          )
        : null}
    </section>
  );
};
