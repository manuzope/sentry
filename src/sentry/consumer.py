from __future__ import absolute_import, print_function

import logging
import six

from batching_kafka_consumer import AbstractBatchWorker


logger = logging.getLogger('sentry.consumer')

# We need a unique value to indicate when to stop multiprocessing queue
# an identity on an object() isn't guaranteed to work between parent
# and child proc
_STOP_WORKER = '91650ec271ae4b3e8a67cdc909d80f8c'


def handle_preprocess(message):
    import sentry.tasks.store as store_tasks

    data = message['data']
    event_id = data['event_id']
    cache_key = message['cache_key']
    start_time = message['start_time']
    process_task = (
        store_tasks.process_event_from_reprocessing
        if message['from_reprocessing']
        else store_tasks.process_event
    )

    store_tasks._do_preprocess_event(cache_key, data, start_time, event_id, process_task)


def handle_process(message):
    import sentry.tasks.store as store_tasks

    data = message['data']
    event_id = data['event_id']
    cache_key = message['cache_key']
    start_time = message['start_time']

    if message['from_reprocessing']:
        task = store_tasks.process_event_from_reprocessing
    else:
        task = store_tasks.process_event

    task.delay(cache_key=cache_key, start_time=start_time, event_id=event_id)


def handle_save(message):
    import sentry.tasks.store as store_tasks

    data = message['data']
    event_id = data['event_id']
    cache_key = message['cache_key']
    start_time = message['start_time']
    project_id = data['project']

    store_tasks._do_save_event(cache_key, data, start_time, event_id, project_id)


dispatch = {}
topic_to_dead_topic_key = {}


def handle_task(task):
    from sentry.utils import json

    if not dispatch:
        from django.conf import settings

        for key, handler in (
            (settings.KAFKA_PREPROCESS, handle_preprocess),
            (settings.KAFKA_PROCESS, handle_process),
            (settings.KAFKA_SAVE, handle_save)
        ):
            topic = settings.KAFKA_TOPICS[key]['topic']
            dispatch[topic] = handler
            topic_to_dead_topic_key[topic] = key + '-dead'

    topic = task['topic']
    handler = dispatch[topic]

    try:
        handler(json.loads(task['value']))
    except Exception:
        from sentry.utils import kafka

        topic_config = kafka.get_topic_config(topic)
        dead_letter_key = topic_config.get('dead-letter-key')
        if not dead_letter_key:
            logger.exception(
                "Error handling message on topic '%s' and no dead-letter-topic is defined.")
            return

        dead_letter_topic = kafka.get_topic_key_config(dead_letter_key)['topic']
        logger.exception(
            "Error handling message on topic '%s', sending to dead letter topic: '%s'." % (
                topic, dead_letter_topic)
        )

        kafka.produce_sync(
            dead_letter_key,
            value=task['value'],
            headers={
                'partition': task['partition'],
                'offset': task['offset'],
                'topic': topic,
            },
        )


def multiprocess_worker(task_queue):
    # Configure within each Process
    configured = False

    while True:
        if not configured:
            from sentry.runner import configure
            configure()

            import signal
            signal.signal(signal.SIGINT, signal.SIG_IGN)

            configured = True

        task = task_queue.get()
        if task == _STOP_WORKER:
            task_queue.task_done()
            return

        handle_task(task)
        task_queue.task_done()


class ConsumerWorker(AbstractBatchWorker):
    def __init__(self, concurrency):
        from multiprocessing import Process, JoinableQueue as Queue

        self.concurrency = concurrency
        self.pool = []

        if self.concurrency > 1:
            self.task_queue = Queue(1000)
            for _ in xrange(concurrency):
                p = Process(target=multiprocess_worker, args=(self.task_queue,))
                p.daemon = True
                p.start()
                self.pool.append(p)

    def process_message(self, message):
        task = {
            'topic': message.topic(),
            'value': message.value(),
            'partition': six.text_type(message.partition()) if message.partition() else None,
            'offset': six.text_type(message.offset()) if message.offset() else None,
        }

        if self.concurrency > 1:
            self.task_queue.put(task)
        else:
            handle_task(task)

    def flush_batch(self, batch):
        if self.concurrency > 1:
            # Batch flush is when Kafka offsets are committed. We await the completion
            # of all submitted tasks so that we don't publish offsets for anything
            # that hasn't been processed.
            self.task_queue.join()

    def shutdown(self):
        if self.concurrency > 1:
            # Shut down our pool
            for _ in self.pool:
                self.task_queue.put(_STOP_WORKER)

            # And wait for it to drain
            for p in self.pool:
                p.join()