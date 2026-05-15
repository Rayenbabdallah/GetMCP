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
    const svc = new GeneratorService({ effectiveVerdict: (c: any) => c.overrideExposeExternally ?? c.exposeExternally } as any);
    const spec: any = {
      info: { title: 'X' },
      paths: {
        '/v1/charges': { get: {}, post: {} },
        '/admin/users': { delete: {} },
      },
    };
    const classifications: any[] = [
      { path: '/v1/charges', method: 'get', exposeExternally: true, overrideExposeExternally: null },
      { path: '/v1/charges', method: 'post', exposeExternally: false, overrideExposeExternally: null },
      { path: '/admin/users', method: 'delete', exposeExternally: false, overrideExposeExternally: true }, // human override
    ];
    const result = svc.buildFromClassifications(spec, classifications, 'h', 'heuristic', false);
    expect(result.internalEndpointsCount).toBe(3);
    expect(result.externalEndpointsCount).toBe(2);
    expect(Object.keys(result.externalMcp.paths)).toEqual(expect.arrayContaining(['/v1/charges', '/admin/users']));
    // Only GET kept on /v1/charges (POST excluded)
    expect(Object.keys(result.externalMcp.paths['/v1/charges'])).toEqual(['get']);
  });
});
