import { Button } from '@shared/ui/Button';
import type { FC } from 'react';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import type { MarginLineSide, SheetPoint } from '../../../../../lib/paper';
import { mirrorSheetRuling } from '../../../../../lib/paper';
import { useMarkupEditorStore } from '../../../../../model/useMarkupEditorStore';
import type { MarkupMoveSource } from '../MarkupHandle';
import { MarkupHandle } from '../MarkupHandle';
import { toPointsAttribute } from '../MarkupOverlay/markupGeometry';
import { MarkupStroke } from '../MarkupStroke';
import { mirrorMarkupPoint } from '../MarkupViewport';
import type { MarkupToolProps } from '../SheetMarkupEditor.types';

import {
  MARGIN_CORNERS,
  readMarginCorner,
  resolveCornerMove,
  resolveMarginHandles,
} from './marginsGeometry';
import type {
  GuideMarginSide,
  MarginCorner,
  SideHandleEnd,
} from './marginsGeometry.types';
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

const SIDE_HANDLE_ENDS: SideHandleEnd[] = ['top', 'bottom'];

const MARGIN_LINE_LABELS: Record<SideHandleEnd, string> = {
  top: 'Линия поля сверху',
  bottom: 'Линия поля снизу',
};

/**
 * Имена углов области текста. На зеркальной странице угол назван тем, каким
 * его видно: углы там — углы её собственной области текста.
 */
const CORNER_LABELS: Record<MarginCorner, string> = {
  topLeft: 'Левый верхний угол полей',
  topRight: 'Правый верхний угол полей',
  bottomRight: 'Правый нижний угол полей',
  bottomLeft: 'Левый нижний угол полей',
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
 * Инструмент «Поля»: область текста — четыре угла, как контур листа, и
 * направляющие верхнего и нижнего полей вдоль линий. Угол тянут в обе
 * стороны сразу: по высоте он ведёт свою направляющую, и при отпускании она
 * встаёт на ближайшую линию разлиновки — соседний угол едет по высоте
 * вместе с ним; вдоль строки — конец своего бокового поля, и поле идёт через
 * оба своих угла: на листе, снятом на столе, оно ставится вдоль наклонной
 * стороны листа. Ручка в середине верхнего и нижнего края двигает только
 * поле по высоте: угол тянет за собой и боковое поле, а поправить одну
 * строку начала текста, не задев полей по бокам, рукой иначе не выйдет.
 *
 * Линия поля правится двумя своими ручками — на трети и двух третях высоты
 * листа. Её можно убрать и добавить: добавленная появляется у ближайшей
 * стороны листа без наклона и сразу идёт за указателем. Отпущенная ручка
 * линии поля притягивается к черте фотографии, а сторона листа выводится из
 * положения линии относительно середины листа.
 *
 * На зеркальной странице углы — видимые углы её области текста, в
 * отражённом слое ручек: по высоте они правят поля, общие с листом, вдоль
 * строки — боковые поля зеркала, если те заданы отдельно. Линия поля
 * зеркала правится в его разделе.
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
    moveCorner,
    releaseCorner,
    moveSideEnd,
    releaseSideEnd,
    removeMarginLine,
    addMarginLine,
  } = useMarginsEdit(frame, isMirrorPage ? null : handleLayer, isMirrorPage);

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

    /**
     * Ручка середины края ходит только по высоте: стрелка вдоль строк её не
     * двигает, а стрелка поперёк сдвигает поле на пиксель мимо линий.
     *
     * @param point — точка отпускания, px фотографии
     * @param source — чем сдвинули
     */
    const handleMarginMoveEnd = (point: SheetPoint, source: MarkupMoveSource) => {
      if (source === 'keyboard' && point.y === y) {
        return;
      }

      releaseMargin(side, point, source === 'pointer');
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
   * Углы на зеркале — углы его области текста: её боковые поля свои, а слой
   * ручек отражён, и точка угла переводится в пиксели листа.
   */
  const cornerHandles = isMirrorPage
    ? resolveMarginHandles(mirrorSheetRuling(ruling, frame), frame)
    : handles;

  const corners = MARGIN_CORNERS.map((corner) => {
    const { x, y } = mirrorMarkupPoint(
      readMarginCorner(cornerHandles, corner),
      isMirrorPage ? width : null
    );

    const handleCornerMove = (point: SheetPoint) => {
      moveCorner(corner, point);
    };

    const handleCornerMoveEnd = (point: SheetPoint, source: MarkupMoveSource) => {
      releaseCorner(corner, point, resolveCornerMove(source, { x, y }, point));
    };

    return (
      <MarkupHandle
        key={corner}
        x={x}
        y={y}
        label={CORNER_LABELS[corner]}
        className="in-data-pan-mode:pointer-events-none"
        onMove={handleCornerMove}
        onMoveEnd={handleCornerMoveEnd}
      />
    );
  });

  /**
   * Ручки линии поля правятся только на странице листа: у зеркала линия
   * поля своя и правится в его разделе.
   */
  const { marginLine } = handles;
  const marginLineHandles =
    isMirrorPage || !marginLine
      ? []
      : SIDE_HANDLE_ENDS.map((end) => {
          const { x, y } = marginLine[end];

          const handleMarginLineMove = (point: SheetPoint) => {
            moveSideEnd('marginLine', end, point);
          };

          /**
           * Стрелкой ручку линии поля сдвигают на пиксель мимо черты — магнит
           * вернул бы её обратно.
           *
           * @param point — точка отпускания, px фотографии
           * @param source — чем сдвинули
           */
          const handleMarginLineMoveEnd = (
            point: SheetPoint,
            source: MarkupMoveSource
          ) => {
            releaseSideEnd('marginLine', end, point, source === 'pointer');
          };

          return (
            <MarkupHandle
              key={`marginLine-${end}`}
              x={x}
              y={y}
              label={MARGIN_LINE_LABELS[end]}
              className="stroke-danger in-data-pan-mode:pointer-events-none"
              onMove={handleMarginLineMove}
              onMoveEnd={handleMarginLineMoveEnd}
            />
          );
        });

  return (
    <section aria-label="Поля листа" className="flex flex-col gap-2 text-sm">
      <p className="text-fg-muted">
        Тяните углы области текста: по высоте поле встанет на ближайшую линию, в сторону —
        сдвинется край бокового поля. Ручка в середине края двигает только верхнее или
        нижнее поле. Текст не заходит за поля и отступает от линии поля.
      </p>

      {isMirrorPage ? (
        <p className="text-fg-muted">
          Боковые поля и линия поля зеркальной страницы задаются в её разделе ниже. Пока
          они отражены, углы двигают только верхнее и нижнее поля.
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

              {corners}

              {marginLineHandles}
            </g>,
            handleLayer
          )
        : null}
    </section>
  );
};
