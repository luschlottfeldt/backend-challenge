import { Controller, Get, Header } from '@nestjs/common';
import { PrometheusMetrics } from '../../infrastructure/observability/prometheus-metrics.js';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: PrometheusMetrics) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  collect(): Promise<string> {
    return this.metrics.collect();
  }
}
