import { EmptyState } from '@components/emptyState/EmptyState';
import { cleanClasses } from '@utils/cleanClasses';
import { Fragment, type ReactNode } from 'react';
import './dataTable.less';

export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
  mono?: boolean;
}

interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row) => string;
  getGroup?: (row: Row) => string;
  emptyText: string;
}

export const DataTable = <Row,>({
  columns,
  rows,
  getRowKey,
  getGroup,
  emptyText,
}: DataTableProps<Row>) => {
  if (rows.length === 0) return <EmptyState>{emptyText}</EmptyState>;

  return (
    <div className="pp-data-table">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const group = getGroup?.(row);
            const isNewGroup =
              group !== undefined &&
              (index === 0 || getGroup?.(rows[index - 1]) !== group);
            return (
              <Fragment key={getRowKey(row)}>
                {isNewGroup && (
                  <tr className="group">
                    <th colSpan={columns.length} scope="colgroup">
                      {group}
                    </th>
                  </tr>
                )}
                <tr>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cleanClasses(column.mono && 'mono')}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
