import chalk from 'chalk';
import { Listr } from 'listr2';

/**
 * Parallel processing service for handling concurrent operations with listr2
 */
export class ParallelService {
  constructor(options = {}) {
    this.defaultConcurrency = options.concurrency || 3;
    this.exitOnError = options.exitOnError || false;
    this.debug = options.debug || false;
  }

  /**
   * Create a parallel task runner for scanning operations
   */
  async createScanTasks(items, scanFunction, options = {}) {
    const concurrency = options.concurrency || this.defaultConcurrency;
    const title = options.title || 'Scanning items in parallel';

    const scanTasks = items.map(item => ({
      title: `Scanning ${item}`,
      task: async (ctx, task) => {
        try {
          const result = await scanFunction(item);
          
          // Store results in context
          ctx.scanResults = ctx.scanResults || {};
          ctx.scanResults[item] = result;
          
          // Update task title with results
          if (result && typeof result === 'object' && result.count !== undefined) {
            task.title = `Scanning ${item} (${result.count} items found)`;
          } else if (Array.isArray(result)) {
            task.title = `Scanning ${item} (${result.length} items found)`;
          } else {
            task.title = `Scanning ${item} - completed`;
          }
        } catch (error) {
          ctx.scanResults = ctx.scanResults || {};
          ctx.scanResults[item] = { error: error.message };
          task.skip(`Failed to scan ${item}: ${error.message}`);
        }
      }
    }));

    const mainTask = new Listr([
      {
        title: title,
        task: async (ctx, task) => {
          return task.newListr(scanTasks, { 
            concurrent: concurrency,
            exitOnError: this.exitOnError 
          });
        }
      }
    ], { concurrent: false });

    return await mainTask.run();
  }

  /**
   * Create a parallel task runner for processing operations
   */
  async createProcessTasks(items, processFunction, options = {}) {
    const concurrency = options.concurrency || this.defaultConcurrency;
    const title = options.title || 'Processing items in parallel';
    const progressCallback = options.progressCallback;

    const processTasks = items.map((item, index) => ({
      title: options.getTitleFor ? options.getTitleFor(item) : `Processing ${item}`,
      task: async (ctx, task) => {
        try {
          const result = await processFunction(item, index);
          
          // Store results in context
          ctx.processResults = ctx.processResults || [];
          ctx.processResults.push(result);
          
          // Update task title based on result
          if (result && result.status) {
            const statusEmoji = result.status === 'SUCCESS' ? '✅' : '❌';
            task.title = `${statusEmoji} ${options.getTitleFor ? options.getTitleFor(item) : `Processing ${item}`}`;
          } else {
            task.title = `✅ ${options.getTitleFor ? options.getTitleFor(item) : `Processing ${item}`}`;
          }

          // Call progress callback if provided
          if (progressCallback) {
            progressCallback(result, index, items.length);
          }
        } catch (error) {
          ctx.processResults = ctx.processResults || [];
          ctx.processResults.push({
            item,
            status: 'FAILED',
            error: error.message,
            timestamp: new Date().toISOString()
          });
          
          task.title = `❌ ${options.getTitleFor ? options.getTitleFor(item) : `Processing ${item}`} - FAILED`;
          
          if (!this.exitOnError) {
            // Don't throw error, just mark as failed
            return;
          }
          throw error;
        }
      }
    }));

    const mainTask = new Listr([
      {
        title: `${title} (${items.length} items)`,
        task: async (ctx, task) => {
          return task.newListr(processTasks, { 
            concurrent: concurrency,
            exitOnError: this.exitOnError 
          });
        }
      }
    ], { 
      concurrent: false,
      exitOnError: this.exitOnError,
      rendererOptions: {
        collapseErrors: false,
        showErrorMessage: true,
        persistentOutput: this.debug
      }
    });

    return await mainTask.run();
  }

  /**
   * Create a combined scan and process workflow
   */
  async createScanAndProcessWorkflow(scanItems, scanFunction, processFunction, options = {}) {
    const concurrency = options.concurrency || this.defaultConcurrency;
    
    console.log(chalk.blue(`🚀 Starting parallel workflow with ${concurrency} concurrent jobs`));

    // Phase 1: Scanning
    console.log(chalk.yellow('📊 Phase 1: Scanning...'));
    const scanContext = await this.createScanTasks(scanItems, scanFunction, {
      concurrency,
      title: options.scanTitle || 'Scanning items for processing'
    });

    // Prepare items for processing based on scan results
    const itemsToProcess = [];
    for (const [scanItem, scanResult] of Object.entries(scanContext.scanResults)) {
      if (scanResult.error) {
        console.log(chalk.red(`⚠️  Skipping ${scanItem} due to scan error: ${scanResult.error}`));
        continue;
      }

      // Extract items from scan result
      const items = options.extractItemsFromScanResult 
        ? options.extractItemsFromScanResult(scanItem, scanResult)
        : scanResult;

      if (Array.isArray(items)) {
        itemsToProcess.push(...items);
      } else if (items) {
        itemsToProcess.push(items);
      }
    }

    if (itemsToProcess.length === 0) {
      console.log(chalk.yellow('🤷 No items found to process after scanning'));
      return { scanResults: scanContext.scanResults, processResults: [] };
    }

    console.log(chalk.green(`✅ Scan complete. Found ${itemsToProcess.length} items to process`));

    // Phase 2: Processing
    console.log(chalk.yellow('⚙️  Phase 2: Processing...'));
    const processContext = await this.createProcessTasks(itemsToProcess, processFunction, {
      concurrency,
      title: options.processTitle || 'Processing items',
      getTitleFor: options.getTitleForProcess,
      progressCallback: options.progressCallback
    });

    console.log(chalk.green('🎉 Parallel workflow completed!'));

    return {
      scanResults: scanContext.scanResults,
      processResults: processContext.processResults || []
    };
  }

  /**
   * Utility function to generate summary statistics
   */
  generateSummary(results, options = {}) {
    if (!Array.isArray(results)) {
      return { total: 0, successful: 0, failed: 0, skipped: 0 };
    }

    const total = results.length;
    const successful = results.filter(r => r.status === 'SUCCESS' || (!r.status && !r.error)).length;
    const failed = results.filter(r => r.status === 'FAILED' || r.error).length;
    const skipped = total - successful - failed;

    if (options.printSummary !== false) {
      console.log(chalk.green('\n=== Processing Summary ==='));
      console.log(chalk.green(`Total items: ${total}`));
      console.log(chalk.green(`✅ Successful: ${successful}`));
      if (failed > 0) {
        console.log(chalk.red(`❌ Failed: ${failed}`));
      }
      if (skipped > 0) {
        console.log(chalk.yellow(`⏭️  Skipped: ${skipped}`));
      }
    }

    return { total, successful, failed, skipped };
  }

  /**
   * Create a rate-limited parallel processor
   */
  async createRateLimitedTasks(items, processFunction, options = {}) {
    const batchSize = options.batchSize || 10;
    const delayBetweenBatches = options.delay || 1000; // ms
    const concurrency = Math.min(options.concurrency || this.defaultConcurrency, batchSize);
    
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    console.log(chalk.blue(`🔄 Processing ${items.length} items in ${batches.length} batches (${batchSize} items per batch)`));

    let allResults = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      
      console.log(chalk.cyan(`📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} items)`));

      const batchContext = await this.createProcessTasks(batch, processFunction, {
        concurrency,
        title: `Batch ${batchIndex + 1}/${batches.length}`,
        getTitleFor: options.getTitleFor,
        progressCallback: options.progressCallback
      });

      allResults.push(...(batchContext.processResults || []));

      // Add delay between batches (except for the last batch)
      if (batchIndex < batches.length - 1 && delayBetweenBatches > 0) {
        console.log(chalk.gray(`⏳ Waiting ${delayBetweenBatches}ms before next batch...`));
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    return { processResults: allResults };
  }
}

export default ParallelService;
