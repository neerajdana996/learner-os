import type { AdminReport } from '@learnos/shared';
import { api } from '../../store/api';

export const adminApi = api.injectEndpoints({
  endpoints: (build) => ({
    adminMetrics: build.query<AdminReport, void>({
      query: () => '/admin/metrics',
    }),
  }),
});

export const { useAdminMetricsQuery } = adminApi;
