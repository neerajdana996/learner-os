import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from './index';

// Typed hooks — use these instead of the raw react-redux ones.
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
