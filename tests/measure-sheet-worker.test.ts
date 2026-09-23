import type { SheetPhotoOptions } from '@pages/Generator/lib/paper';
import { measureSheetPhoto } from '@pages/Generator/lib/paper';
import { createMeasureSheetClient } from '@pages/Generator/model/createMeasureSheetClient';
import type {
  MeasureSheetPort,
  MeasureSheetRequest,
  MeasureSheetResponse,
  SheetPhotoAnalysis,
} from '@pages/Generator/model/measureSheetWorker.types';
import { analyzeSheetPhoto } from '@pages/Generator/ui/Generator/SettingsPane/useSheetImport';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSyntheticSheet } from './helpers/synthetic-sheet';

const { decodeSheetImage } = vi.hoisted(() => {
  return { decodeSheetImage: vi.fn() };
});

vi.mock(
  '@pages/Generator/ui/Generator/SettingsPane/useSheetImport/decodeSheetImage',
  () => {
    return { decodeSheetImage };
  }
);

/**
 * Небольшой лист в клетку: разбирается за доли секунды и всё же даёт
 * разлиновку, по которой видно, что измерение действительно прошло.
 */
const SMALL_SHEET = createSyntheticSheet({ width: 480, height: 640, step: 24, seed: 3 });

const GRID_OPTIONS: SheetPhotoOptions = { kind: 'grid' };

/**
 * Порт-записыватель: копит задания и отвечает тогда, когда велит тест.
 */
type RecordingPort = MeasureSheetPort & {
  /**
   * Отправленные задания по порядку.
   */
  requests: MeasureSheetRequest[];

  /**
   * Присылает ответ так, как прислал бы его воркер.
   */
  reply: (response: MeasureSheetResponse) => void;

  /**
   * Роняет воркер.
   */
  crash: () => void;

  /**
   * Воркер остановлен клиентом.
   */
  isTerminated: boolean;
};

const createRecordingPort = (): RecordingPort => {
  const responseListeners: ((response: MeasureSheetResponse) => void)[] = [];
  const crashListeners: (() => void)[] = [];
  const port: RecordingPort = {
    requests: [],
    isTerminated: false,
    postMessage: (request) => {
      port.requests.push(request);
    },
    onResponse: (listener) => {
      responseListeners.push(listener);
    },
    onCrash: (listener) => {
      crashListeners.push(listener);
    },
    terminate: () => {
      port.isTerminated = true;
    },
    reply: (response) => {
      responseListeners.forEach((listener) => {
        listener(response);
      });
    },
    crash: () => {
      crashListeners.forEach((listener) => {
        listener();
      });
    },
  };

  return port;
};

const PHOTO = new Blob(['jpeg'], { type: 'image/jpeg' });

/**
 * Разбор, который вернул бы воркер: содержимое клиенту не важно, он его только
 * передаёт дальше.
 */
const createAnalysis = (): SheetPhotoAnalysis => {
  return {
    image: SMALL_SHEET,
    measurement: measureSheetPhoto(SMALL_SHEET, GRID_OPTIONS),
    texture: null,
  };
};

describe('клиент воркера разбора листа', () => {
  it('открывает один порт на все задания и отвечает по номеру задания', async () => {
    const ports: RecordingPort[] = [];
    const client = createMeasureSheetClient({
      createPort: () => {
        const port = createRecordingPort();

        ports.push(port);

        return port;
      },
    });

    const first = client.measure(PHOTO, GRID_OPTIONS);
    const second = client.measure(PHOTO, { kind: 'blank', outline: null });
    const [port] = ports;

    expect(ports).toHaveLength(1);
    expect(
      port?.requests.map(({ options }) => {
        return options;
      })
    ).toStrictEqual([GRID_OPTIONS, { kind: 'blank', outline: null }]);
    expect(port?.requests[0]?.photo).toBe(PHOTO);

    const analysis = createAnalysis();

    port?.reply({
      requestId: port.requests[1]?.requestId || 0,
      status: 'done',
      analysis: null,
    });
    port?.reply({
      requestId: port.requests[0]?.requestId || 0,
      status: 'done',
      analysis,
    });

    await expect(first).resolves.toBe(analysis);
    await expect(second).resolves.toBeNull();
  });

  it('отдаёт отказ воркера текстом его сообщения', async () => {
    const port = createRecordingPort();
    const client = createMeasureSheetClient({
      createPort: () => {
        return port;
      },
    });

    const job = client.measure(PHOTO, GRID_OPTIONS);

    port.reply({
      requestId: port.requests[0]?.requestId || 0,
      status: 'failed',
      message: 'Канва недоступна',
    });

    await expect(job).rejects.toThrow('Канва недоступна');
  });

  it('при падении воркера отказывает всем ждущим и открывает новый порт', async () => {
    const ports: RecordingPort[] = [];
    const client = createMeasureSheetClient({
      createPort: () => {
        const port = createRecordingPort();

        ports.push(port);

        return port;
      },
    });

    const first = client.measure(PHOTO, GRID_OPTIONS);
    const second = client.measure(PHOTO, GRID_OPTIONS);

    ports[0]?.crash();

    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
    expect(ports[0]?.isTerminated).toBe(true);

    void client.measure(PHOTO, GRID_OPTIONS);

    expect(ports).toHaveLength(2);
    expect(ports[1]?.requests).toHaveLength(1);
  });
});

describe('разбор фотографии там, где воркера нет', () => {
  beforeEach(() => {
    decodeSheetImage.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('идёт в основном потоке и даёт то же измерение', async () => {
    vi.stubGlobal('Worker', undefined);
    decodeSheetImage.mockResolvedValue(SMALL_SHEET);

    const analysis = await analyzeSheetPhoto(
      { src: 'data:image/jpeg;base64,' },
      GRID_OPTIONS
    );

    expect(decodeSheetImage).toHaveBeenCalledWith('data:image/jpeg;base64,');
    expect(analysis?.image).toBe(SMALL_SHEET);
    expect(analysis?.measurement).toStrictEqual(
      measureSheetPhoto(SMALL_SHEET, GRID_OPTIONS)
    );
    expect(analysis?.measurement.source.step).toBeGreaterThan(0);
  });

  it('неразобранная фотография даёт пустой разбор, а не отказ', async () => {
    vi.stubGlobal('Worker', undefined);
    decodeSheetImage.mockResolvedValue(null);

    await expect(
      analyzeSheetPhoto({ src: 'data:image/jpeg;base64,' }, GRID_OPTIONS)
    ).resolves.toBeNull();
  });
});

describe('разбор фотографии, когда воркер есть', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('уходит в воркер файлом, не декодируя фотографию в основном потоке', async () => {
    const posted: MeasureSheetRequest[] = [];

    /**
     * Воркер-заглушка: отвечает пустым разбором на каждое задание.
     */
    class FakeWorker {
      private listener: ((event: MessageEvent<MeasureSheetResponse>) => void) | null =
        null;

      addEventListener(
        type: string,
        listener: (event: MessageEvent<MeasureSheetResponse>) => void
      ) {
        if (type === 'message') {
          this.listener = listener;
        }
      }

      postMessage(request: MeasureSheetRequest) {
        posted.push(request);
        queueMicrotask(() => {
          this.listener?.(
            new MessageEvent('message', {
              data: { requestId: request.requestId, status: 'done', analysis: null },
            })
          );
        });
      }

      terminate() {}
    }

    vi.stubGlobal('Worker', FakeWorker);
    decodeSheetImage.mockReset();

    await expect(
      analyzeSheetPhoto({ src: 'data:image/jpeg;base64,', blob: PHOTO }, GRID_OPTIONS)
    ).resolves.toBeNull();
    expect(posted).toHaveLength(1);
    expect(posted[0]?.photo).toBe(PHOTO);
    expect(posted[0]?.options).toStrictEqual(GRID_OPTIONS);
    expect(decodeSheetImage).not.toHaveBeenCalled();
  });
});
