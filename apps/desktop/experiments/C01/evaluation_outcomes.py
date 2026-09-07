def assertion_outcome(status, exit_code):
    if exit_code is None:
        return 'unknown'
    if status == 'failed':
        return 'fail'
    if status == 'passed' and exit_code == 0:
        return 'pass'
    return 'unknown'
