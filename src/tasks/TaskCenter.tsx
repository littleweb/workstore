import { useState, useSyncExternalStore } from 'react';
import { Button, Drawer, Empty, Progress, Tag, Tooltip } from 'antd';
import { UnorderedListOutlined } from '@ant-design/icons';
import { cancelTask, clearFinishedTasks, isRunning, subscribeTasks, taskSnapshot } from './store';
import './tasks.css';
const names: Record<string,string> = {'app.course':'做课程','app.design':'设计室','app.doc':'记笔记','app.whiteboard':'画白板','app.comic':'小漫画','app.story-comic':'画漫画','app.cover':'做封面','app.html':'HTML','app.animation':'小动画'};
const states = {running:'进行中',stopping:'正在停止',done:'已完成',error:'失败',cancelled:'已停止'};
export default function TaskCenter({onOpen}: {onOpen(toolId: string): void}) {
  const [open, setOpen] = useState(false);
  const tasks = useSyncExternalStore(subscribeTasks, taskSnapshot);
  const count = tasks.filter(isRunning).length;
  const groups = [...new Set(tasks.map(task => task.toolId))];
  return <><Tooltip title={count ? `后台任务 · ${count} 项进行中` : '后台任务'}>
    <button className="icon-button task-center-trigger" aria-label="后台任务" onClick={() => setOpen(true)}><UnorderedListOutlined />{count > 0 && <span className="task-count">{count}</span>}</button>
  </Tooltip><Drawer title="后台任务" open={open} onClose={() => setOpen(false)} width={440} extra={<Button size="small" type="text" onClick={clearFinishedTasks}>清除已结束</Button>}>
    <p className="task-explanation">切换工具后继续运行，可随时返回查看结果。退出应用会停止未完成的任务。</p>
    {!tasks.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />}
    {groups.map(toolId => <section className="task-group" key={toolId}><h3>{names[toolId] ?? toolId}</h3>{tasks.filter(task => task.toolId === toolId).map(task => <article className="background-task" key={task.id}>
      <div className="task-heading"><strong>{task.title}</strong><Tag color={task.state === 'error' ? 'red' : task.state === 'done' ? 'green' : isRunning(task) ? 'blue' : undefined}>{states[task.state]}</Tag></div>
      <p role="status">{task.error || (task.state === 'done' ? '处理完成，请打开工具查看结果' : task.state === 'cancelled' ? '任务已停止，已保存的内容保留' : task.stage)}</p>
      {isRunning(task) && task.total && task.total > 0 ? <Progress size="small" percent={Math.min(100, Math.round((task.done ?? 0) / task.total * 100))} /> : isRunning(task) && <div className="task-working" />}
      <div className="task-footer"><time>{new Date(task.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time><div><Button size="small" type="text" onClick={() => {onOpen(task.toolId);setOpen(false);}}>打开工具</Button>{isRunning(task) && task.cancellable !== false && <Button size="small" type="text" disabled={task.state === 'stopping'} onClick={() => cancelTask(task.id)}>停止</Button>}</div></div>
    </article>)}</section>)}
  </Drawer></>;
}
