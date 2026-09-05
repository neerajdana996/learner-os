import { api } from '../../store/api';
import type { MapResponse } from '../../shared';

export const mapApi = api.injectEndpoints({
  endpoints: (build) => ({
    map: build.query<MapResponse, string>({
      query: (topicId) => `/topics/${topicId}/map`,
      providesTags: (_r, _e, topicId) => [{ type: 'Map', id: topicId }],
    }),
  }),
});

export const { useMapQuery } = mapApi;
