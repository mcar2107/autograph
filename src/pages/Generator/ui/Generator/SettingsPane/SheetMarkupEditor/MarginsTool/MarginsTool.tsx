import { Button } from '@shared/ui/Button';
import type { FC } from 'react';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import type { MarginLineSide, SheetPoint, SideEdge } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import type { MarkupMoveSource } from '../MarkupHandle';
import { MarkupHandle } from '../MarkupHandle';
import { toPointsAttribute } from '../MarkupOverlay/markupGeometry';
import { MarkupStroke } from '../MarkupStroke';
import type { MarkupToolProps } from '../SheetMarkupEditor.types';

import { resolveMarginHandles } from './marginsGeometry';
import type { GuideMarginSide, SideHandleEnd } from './marginsGeometry.types';
import { useMarginsEdit } from './useMarginsEdit';

/**
 * Поля, общие у листа и зеркальной страницы: боковые поля и линия поля у
 * зеркала свои и правятся в его разделе.
 */
const GUIDE_MARGIN_SIDES: GuideMarginSide[] = ['top', 'bottom'];

const GUIDE_MARGIN_LABELS: Record<GuideMarginSide, string> = {
  top: 'Верхнее поле',
  bottom: 'Нижнее поле',
};

const SIDE_EDGES: SideEdge[] = ['left', 'right', 'marginLine'];

const SIDE_HANDLE_ENDS: SideHandleEnd[] = ['top', 'bottom'];

/**
 * Имена ручек боковых границ: у каждой границы две ручки, верхняя и нижняя.
 */
const SIDE_HANDLE_LABELS: Record<SideEdge, Record<SideHandleEnd, string>> = {
  left: { top: 'Левое поле сверху', bottom: 'Левое поле снизу' },
  right: { top: 'Правое поле сверху', bottom: 'Правое поле снизу' },
  marginLine: { top: 'Линия поля сверху', bottom: 'Линия поля снизу' },
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
 * нижняя при отпускании встают на ближайшую линию разлиновки. Боковые поля и
 * линия поля правятся двумя ручками — верхней и нижней, — и граница идёт
 * через обе: на листе, снятом на столе, поле ставится вдоль наклонной стороны
 * листа. Ручки боковых полей стоят, где отпущены. Линию поля можно убрать и
 * добавить: добавленная появляется у ближайшей стороны листа без наклона и
 * сразу идёт за указателем. Отпущенная ручка линии поля притягивается к черте
 * фотографии, а сторона листа выводится из положения линии относительно
 * середины листа.
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
    moveSideEnd,
    releaseSideEnd,
    removeMarginLine,
    addMarginLine,
  } = useMarginsEdit(frame, pageIndex === 0 ? handleLayer : null);

  if (!draft) {
    return null;
  }

  const { ruling } = draft;
  const { marginLineSide } = ruling;
  const handles = resolveMarginHandles(ruling, frame);
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

  const guideHandles = GUIDE_MARGIN_SIDES.map((side) => {
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
        label={GUIDE_MARGIN_LABELS[side]}
        className="in-data-pan-mode:pointer-events-none"
        onMove={handleMarginMove}
        onMoveEnd={handleMarginMoveEnd}
      />
    );
  });

  /**
   * Ручки боковых полей и линии поля правятся только на странице листа: у
   * зеркала они свои и правятся в его разделе.
   */
  const sideEdges = isMirrorPage ? [] : SIDE_EDGES;

  const sideHandles = sideEdges.flatMap((edge) => {
    const pair = edge === 'marginLine' ? handles.marginLine : handles[edge];

    if (!pair) {
      return [];
    }

    return SIDE_HANDLE_ENDS.map((end) => {
      const { x, y } = pair[end];

      const handleSideMove = (point: SheetPoint) => {
        moveSideEnd(edge, end, point);
      };

      /**
       * Стрелкой ручку линии поля сдвигают на пиксель мимо черты — магнит
       * вернул бы её обратно.
       *
       * @param point — точка отпускания, px фотографии
       * @param source — чем сдвинули
       */
      const handleSideMoveEnd = (point: SheetPoint, source: MarkupMoveSource) => {
        releaseSideEnd(edge, end, point, source === 'pointer');
      };

      return (
        <MarkupHandle
          key={`${edge}-${end}`}
          x={x}
          y={y}
          label={SIDE_HANDLE_LABELS[edge][end]}
          className={
            edge === 'marginLine'
              ? 'stroke-danger in-data-pan-mode:pointer-events-none'
              : 'in-data-pan-mode:pointer-events-none'
          }
          onMove={handleSideMove}
          onMoveEnd={handleSideMoveEnd}
        />
      );
    });
  });

  return (
    <section aria-label="Поля листа" className="flex flex-col gap-2 text-sm">
      <p className="text-fg-muted">
        Перетащите направляющие полей: верхняя и нижняя встанут на ближайшую линию. У
        бокового поля и линии поля по две ручки — ведите их вдоль края листа. Текст не
        заходит за поля и отступает от линии поля.
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

              {guideHandles}

              {sideHandles}
            </g>,
            handleLayer
          )
        : null}
    </section>
  );
};
