// Typed Redux hooks.
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from './store.js';

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector = <T>(selector: (state: RootState) => T): T =>
  useSelector<RootState, T>(selector);
