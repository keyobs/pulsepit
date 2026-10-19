import { cleanClasses } from '@utils/cleanClasses';
import { TbArrowBigDownLine } from 'react-icons/tb';
import './icons.less';

interface IconProps {
  className?: string;
}

/** Flèche descendante : récupérer l'état du remote. */
export const FetchIcon = ({ className }: IconProps) => (
  <TbArrowBigDownLine
    className={cleanClasses('pp-icon', 'fetch', className)}
    aria-hidden="true"
  />
);
