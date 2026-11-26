import { getRequest } from 'waku/router/server';
import { summary, users } from '../data';

/**
 * APP_SPEC.md `/ssr`: dynamic, 100 rows, zero client components.
 *
 * `render: 'dynamic'` is what makes it per-request; it reads the request as well, like the other apps, so
 * the page shows something only a request could have told it.
 */
export default function Ssr() {
  const agent = getRequest().headers.get('user-agent') ?? 'unknown';

  return (
    <>
      <title>Users</title>
      <h1>Users</h1>
      <p className="summary">
        {summary.count} users · {summary.totalScore.toLocaleString('en-US')} total score · {summary.admins} admins
      </p>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th className="num">Score</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td className="num">{user.id}</td>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>{user.role}</td>
              <td className="num">{user.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="summary">Rendered per request for {agent.slice(0, 40)}</p>
    </>
  );
}

export const getConfig = async () => ({ render: 'dynamic' }) as const;
