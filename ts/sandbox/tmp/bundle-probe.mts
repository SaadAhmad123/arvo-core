import { bundleWorkflowCode } from '@temporalio/worker';

const bundled = await bundleWorkflowCode({
  workflowsPath: new URL('wf-probe.ts', import.meta.url).pathname,
});
console.log('bundled bytes:', bundled.code.length);
