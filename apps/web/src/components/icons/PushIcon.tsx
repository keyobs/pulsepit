import { cleanClasses } from '@utils/cleanClasses';
import { TbArrowBigUpLine } from 'react-icons/tb';
import './icons.less';

interface IconProps {
  className?: string;
}

/** Flèche montante : envoyer une branche vers le remote. */
export const PushIcon = ({ className }: IconProps) => (
  <TbArrowBigUpLine
    className={cleanClasses('pp-icon', 'push', className)}
    aria-hidden="true"
  />
);
