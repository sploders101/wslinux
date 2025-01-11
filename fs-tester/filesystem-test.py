import os
import sys
import time

filesystem = sys.argv[1]
test_file = os.path.join(filesystem, "text.txt")

def test_result(test_name, file, expected, truncate = True):
    file.seek(0)
    result = file.read()
    if result == expected:
        print("PASS: " + test_name)
    else:
        print()
        print("FAIL: " + test_name)
        print("Expected: " + expected)
        print("Received: " + result)
        print()
    if truncate:
        file.seek(0)
        file.truncate(0)

with open(test_file, "w+") as file:
    file.write("Hello, world!\n")
    test_result("Linear write", file, "Hello, world!\n")

    file.seek(20)
    file.write("This is a test")
    file.flush()
    file.seek(0)
    file.write("Hi!")
    test_result("Seek beyond", file, "Hi!" + "\0" * 17 + "This is a test", False)
