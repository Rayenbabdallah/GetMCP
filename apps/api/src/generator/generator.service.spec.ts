import { PassThrough } from 'stream';
import { Test, TestingModule } from '@nestjs/testing';
import { GeneratorService } from './generator.service';
import { ClassifierService } from './classifier.service';

describe('GeneratorService', () => {
  let service: GeneratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeneratorService,
        { provide: ClassifierService, useValue: {} },
      ],
    }).compile();

    service = module.get<GeneratorService>(GeneratorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('buildFromClassifications respects effective verdict (override beats classifier)', () => {
    const svc = new GeneratorService({
      effectiveVerdict: (c: any) =>
        c.overrideExposeExternally ?? c.exposeExternally,
    } as any);
    const spec: any = {
      info: { title: 'X' },
      paths: {
        '/v1/charges': { get: {}, post: {} },
        '/admin/users': { delete: {} },
      },
    };
    const classifications: any[] = [
      {
        path: '/v1/charges',
        method: 'get',
        exposeExternally: true,
        overrideExposeExternally: null,
      },
      {
        path: '/v1/charges',
        method: 'post',
        exposeExternally: false,
        overrideExposeExternally: null,
      },
      {
        path: '/admin/users',
        method: 'delete',
        exposeExternally: false,
        overrideExposeExternally: true,
      }, // human override
    ];
    const result = svc.buildFromClassifications(
      spec,
      classifications,
      'h',
      'heuristic',
      false,
    );
    expect(result.internalEndpointsCount).toBe(3);
    expect(result.externalEndpointsCount).toBe(2);
    expect(Object.keys(result.externalMcp.paths)).toEqual(
      expect.arrayContaining(['/v1/charges', '/admin/users']),
    );
    // Only GET kept on /v1/charges (POST excluded)
    expect(Object.keys(result.externalMcp.paths['/v1/charges'])).toEqual([
      'get',
    ]);
  });

  it('exportInfrastructureZip streams a zip holding both MCP scaffolds', async () => {
    const classifier = {
      effectiveVerdict: (c: any) => c.exposeExternally,
      classify: () =>
        Promise.resolve({
          endpoints: [
            { path: '/v1/charges', method: 'get', exposeExternally: true },
          ],
          specHash: 'h',
          source: 'heuristic',
          cacheHit: false,
        }),
    };
    const svc = new GeneratorService(classifier as any);
    jest.spyOn(svc as any, 'fetchSpec').mockResolvedValue({
      info: { title: 'X' },
      paths: { '/v1/charges': { get: {} } },
    });

    const res: any = new PassThrough();
    const headers: Record<string, string> = {};
    res.set = (h: Record<string, string>) => Object.assign(headers, h);
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    const ended = new Promise((resolve) => res.on('end', resolve));

    await svc.exportInfrastructureZip(
      'org-1',
      'https://example.com/openapi.json',
      res,
    );
    await ended;

    const zip = Buffer.concat(chunks);
    expect(headers['Content-Type']).toBe('application/zip');
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    // File names are stored uncompressed in the zip central directory.
    const names = zip.toString('latin1');
    for (const expected of [
      'internal-mcp/',
      'external-mcp/',
      'docker-compose.yml',
      'README.md',
    ]) {
      expect(names).toContain(expected);
    }
  });
});
